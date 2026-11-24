import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
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

    const context = await requireAuth(request);
    const body = await readJsonObject(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(teamId)
    ) {
      throw new HttpError(
        400,
        "INVALID_TEAM_ID",
        "A valid team ID is required.",
      );
    }
    await requireTeamRole(context, teamId);

    const { data: pending, error } = await context.admin
      .from("alerts_sent")
      .select("id,team_id,channel_id,github_run_id,kind,dedupe_key")
      .eq("team_id", teamId)
      .eq("status", "pending")
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
      try {
        const [
          { data: channel, error: channelError },
          { data: run, error: runError },
        ] = await Promise.all([
          context.admin.from("alert_channels")
            .select("id,channel_type,target,verified_at")
            .eq("id", alert.channel_id)
            .eq("team_id", teamId)
            .maybeSingle(),
          context.admin.from("workflow_runs")
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

        const { data: repository, error: repositoryError } = await context.admin
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

        let providerMessageId = "accepted";
        if (channel.channel_type === "email") {
          const emailResult = await sendEmail(
            channel.target,
            "DevOps Insight AI: " + alert.kind + " workflow alert",
            '<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">' +
              escapeHtml(summary) +
              "</pre>",
          );
          providerMessageId = emailResult;
        } else if (channel.channel_type === "telegram") {
          providerMessageId = await sendTelegramMessage(
            channel.target,
            summary,
          );
        } else {
          throw new Error("Unsupported alert channel.");
        }

        const { error: updateError } = await context.admin.from("alerts_sent")
          .update({
            status: "sent",
            attempted_at: attemptedAt,
            sent_at: new Date().toISOString(),
            provider_message_id: providerMessageId,
            failure_code: null,
          })
          .eq("id", alert.id)
          .eq("team_id", teamId)
          .eq("status", "pending");

        if (updateError) {
          throw new Error("Alert delivery status could not be saved.");
        }
        sent += 1;
      } catch {
        await context.admin.from("alerts_sent").update({
          status: "failed",
          attempted_at: attemptedAt,
          failure_code: "PROVIDER_DELIVERY_FAILED",
        }).eq("id", alert.id).eq("team_id", teamId).eq("status", "pending");
        failed += 1;
      }
    }

    await writeAudit(
      context.admin,
      teamId,
      context.user.id,
      "alerts.dispatch_requested",
      {
        processed_count: (pending ?? []).length,
        sent_count: sent,
        failed_count: failed,
      },
    );

    return jsonResponse(request, {
      ok: true,
      processed: (pending ?? []).length,
      sent,
      failed,
    });
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
