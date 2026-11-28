import {
  createAdminClient,
  requireAuth,
  requireTeamRole,
  writeAudit,
} from "../_shared/auth.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/email.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";
import { constantTimeEqual, sha256Hex } from "../_shared/security.ts";

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MS = 5 * 60 * 1000;

function isValidTeamId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function dueAlertFilter(now = Date.now()): string {
  const staleBefore = new Date(now - STALE_CLAIM_MS).toISOString();
  return [
    "status.eq.pending",
    "and(status.eq.failed,attempt_count.lt." + MAX_ATTEMPTS + ")",
    "and(status.eq.processing,claimed_at.lt." + staleBefore +
    ",attempt_count.lt." + MAX_ATTEMPTS + ")",
    "and(status.eq.processing,claimed_at.lt." + staleBefore +
    ",attempt_count.gte." + MAX_ATTEMPTS + ")",
    "and(status.eq.sending,provider_started_at.lt." + staleBefore + ")",
  ].join(",");
}

function hasSchedulerAuthorization(request: Request): boolean {
  const expected = Deno.env.get("ALERT_SCHEDULER_SECRET")?.trim() ?? "";
  const provided = request.headers.get("x-scheduler-secret") ?? "";
  return expected.length >= 32 && constantTimeEqual(expected, provided);
}

type DispatchSummary = {
  processed: number;
  sent: number;
  failed: number;
};

async function dispatchTeamAlerts(
  admin: SupabaseClient,
  teamId: string,
): Promise<DispatchSummary> {
  const staleSendingBefore = new Date(Date.now() - STALE_CLAIM_MS)
    .toISOString();
  const { error: exhaustedClaimError } = await admin
    .from("alerts_sent")
    .update({
      status: "failed",
      failure_code: "MAX_ATTEMPTS_REACHED",
    })
    .eq("team_id", teamId)
    .eq("status", "processing")
    .lt("claimed_at", staleSendingBefore)
    .gte("attempt_count", MAX_ATTEMPTS);
  if (exhaustedClaimError) {
    throw new HttpError(
      500,
      "ALERT_CLAIM_RECONCILIATION_FAILED",
      "Exhausted alert claims could not be reconciled.",
    );
  }
  const { error: staleSendingError } = await admin
    .from("alerts_sent")
    .update({
      status: "delivery_unknown",
      failure_code: "DELIVERY_OUTCOME_UNKNOWN",
    })
    .eq("team_id", teamId)
    .eq("status", "sending")
    .lt("provider_started_at", staleSendingBefore);
  if (staleSendingError) {
    throw new HttpError(
      500,
      "ALERT_DELIVERY_RECONCILIATION_FAILED",
      "Unconfirmed alert deliveries could not be reconciled.",
    );
  }

  const { data: pending, error } = await admin
    .from("alerts_sent")
    .select(
      "id,team_id,channel_id,github_run_id,kind,dedupe_key,status,attempt_count",
    )
    .eq("team_id", teamId)
    .lte("available_at", new Date().toISOString())
    .or(dueAlertFilter())
    .order("created_at", { ascending: true })
    .limit(25);

  if (error) {
    throw new HttpError(
      500,
      "ALERT_QUEUE_LOOKUP_FAILED",
      "Pending alerts could not be loaded.",
    );
  }

  let sent = 0;
  let failed = 0;
  for (const alert of pending ?? []) {
    const attemptedAt = new Date().toISOString();
    const nextAttempt = Number(alert.attempt_count ?? 0) + 1;
    const { data: claim, error: claimError } = await admin
      .from("alerts_sent")
      .update({
        status: "processing",
        attempt_count: nextAttempt,
        claimed_at: attemptedAt,
        attempted_at: attemptedAt,
        provider_started_at: null,
      })
      .eq("id", alert.id)
      .eq("team_id", teamId)
      .eq("status", alert.status)
      .eq("attempt_count", alert.attempt_count ?? 0)
      .select("id")
      .maybeSingle();

    if (claimError) {
      failed += 1;
      continue;
    }
    if (!claim) continue;

    let providerCallStarted = false;
    try {
      const [
        { data: channel, error: channelError },
        { data: run, error: runError },
      ] = await Promise.all([
        admin.from("alert_channels")
          .select("id,channel_type,target,verified_at")
          .eq("id", alert.channel_id)
          .eq("team_id", teamId)
          .maybeSingle(),
        admin.from("workflow_runs")
          .select(
            "github_run_id,github_repo_id,head_branch,conclusion,html_url",
          )
          .eq("github_run_id", alert.github_run_id)
          .eq("team_id", teamId)
          .maybeSingle(),
      ]);

      if (
        channelError || runError || !channel || !run || !channel.verified_at
      ) {
        throw new Error(
          "Alert channel or workflow run is no longer available.",
        );
      }

      const { data: repository, error: repositoryError } = await admin
        .from("team_repositories")
        .select("full_name")
        .eq("github_repo_id", run.github_repo_id)
        .eq("team_id", teamId)
        .maybeSingle();
      if (repositoryError || !repository) {
        throw new Error("Repository details are unavailable.");
      }

      const summary = [
        "DevOps Insight AI alert",
        "Repository: " + repository.full_name,
        "Workflow run: " + run.github_run_id,
        "Branch: " + String(run.head_branch ?? "unknown"),
        "Result: " + String(run.conclusion ?? "unknown"),
        "Event: " + alert.kind,
        run.html_url ? "Open run: " + run.html_url : "",
      ].filter(Boolean).join("\n");

      if (
        (channel.channel_type === "email" &&
          (!Deno.env.get("RESEND_API_KEY")?.trim() ||
            !Deno.env.get("EMAIL_FROM")?.trim())) ||
        (channel.channel_type === "telegram" &&
          !Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim())
      ) {
        throw new Error("Alert provider is not configured.");
      }
      if (
        channel.channel_type !== "email" && channel.channel_type !== "telegram"
      ) {
        throw new Error("Unsupported alert channel.");
      }

      const { data: sendingClaim, error: sendingError } = await admin
        .from("alerts_sent")
        .update({
          status: "sending",
          provider_started_at: new Date().toISOString(),
        })
        .eq("id", alert.id)
        .eq("team_id", teamId)
        .eq("status", "processing")
        .eq("attempt_count", nextAttempt)
        .select("id")
        .maybeSingle();
      if (sendingError || !sendingClaim) {
        // A concurrent flaky-run reconciliation may have changed this row to skipped.
        continue;
      }

      let providerMessageId = "accepted";
      providerCallStarted = true;
      if (channel.channel_type === "email") {
        providerMessageId = await sendEmail(
          channel.target,
          "DevOps Insight AI: " + alert.kind + " workflow alert",
          '<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">' +
            escapeHtml(summary) +
            "</pre>",
          await sha256Hex(alert.dedupe_key),
        );
      } else {
        providerMessageId = await sendTelegramMessage(channel.target, summary);
      }

      const { error: updateError } = await admin.from("alerts_sent")
        .update({
          status: "sent",
          attempted_at: attemptedAt,
          sent_at: new Date().toISOString(),
          provider_message_id: providerMessageId,
          failure_code: null,
        })
        .eq("id", alert.id)
        .eq("team_id", teamId)
        .eq("status", "sending")
        .eq("attempt_count", nextAttempt);

      if (updateError) {
        await admin.from("alerts_sent").update({
          status: "delivery_unknown",
          failure_code: "DELIVERY_OUTCOME_UNKNOWN",
        }).eq("id", alert.id)
          .eq("team_id", teamId)
          .eq("status", "sending")
          .eq("attempt_count", nextAttempt);
        failed += 1;
        continue;
      }
      sent += 1;
    } catch {
      if (providerCallStarted) {
        // Telegram has no send idempotency key. A timeout or DB failure after
        // the provider call may mean the message was accepted; never auto-retry.
        await admin.from("alerts_sent").update({
          status: "delivery_unknown",
          attempted_at: attemptedAt,
          failure_code: "DELIVERY_OUTCOME_UNKNOWN",
        }).eq("id", alert.id)
          .eq("team_id", teamId)
          .eq("status", "sending")
          .eq("attempt_count", nextAttempt);
      } else {
        await admin.from("alerts_sent").update({
          status: "failed",
          attempted_at: attemptedAt,
          failure_code: nextAttempt >= MAX_ATTEMPTS
            ? "MAX_ATTEMPTS_REACHED"
            : "PROVIDER_NOT_ATTEMPTED",
        }).eq("id", alert.id)
          .eq("team_id", teamId)
          .eq("status", "processing")
          .eq("attempt_count", nextAttempt);
      }
      failed += 1;
    }
  }

  return { processed: (pending ?? []).length, sent, failed };
}

Deno.serve(async (request: Request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      throw new HttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Use POST for this operation.",
      );
    }

    const body = await readJsonObject(request);

    if (hasSchedulerAuthorization(request)) {
      if (body.mode !== "all") {
        throw new HttpError(
          400,
          "INVALID_SCHEDULER_MODE",
          "The scheduler must request mode=all.",
        );
      }

      const admin = createAdminClient();
      const { data: dueRows, error } = await admin
        .from("alerts_sent")
        .select("team_id")
        .or(dueAlertFilter())
        .limit(5000);
      if (error) {
        throw new HttpError(
          500,
          "ALERT_SCHEDULER_LOOKUP_FAILED",
          "Due alert workspaces could not be listed.",
        );
      }

      const teamIds = [
        ...new Set((dueRows ?? []).map((row) => String(row.team_id))),
      ];
      const total: DispatchSummary = { processed: 0, sent: 0, failed: 0 };
      const teamErrors: string[] = [];
      for (const teamId of teamIds) {
        try {
          const result = await dispatchTeamAlerts(admin, teamId);
          total.processed += result.processed;
          total.sent += result.sent;
          total.failed += result.failed;
        } catch {
          teamErrors.push(teamId);
        }
      }

      return jsonResponse(request, {
        ok: true,
        mode: "scheduled",
        workspace_count: teamIds.length,
        ...total,
        workspace_errors: teamErrors.length,
      });
    }

    const context = await requireAuth(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    if (!isValidTeamId(teamId)) {
      throw new HttpError(
        400,
        "INVALID_TEAM_ID",
        "A valid team ID is required.",
      );
    }
    await requireTeamRole(context, teamId);
    const result = await dispatchTeamAlerts(context.admin, teamId);
    await writeAudit(
      context.admin,
      teamId,
      context.user.id,
      "alerts.dispatch_requested",
      result,
    );

    return jsonResponse(request, { ok: true, ...result });
  } catch (error) {
    return handleError(request, error);
  }
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
