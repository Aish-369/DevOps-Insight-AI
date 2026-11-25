import { createAdminClient } from "../_shared/auth.ts";
import { HttpError, jsonResponse } from "../_shared/http.ts";
import { verifyGithubWebhookSignature } from "../_shared/webhook-security.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

type JsonObject = Record<string, unknown>;
type AdminClient = SupabaseClient;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, key: string): JsonObject {
  const candidate = isObject(value) ? value[key] : undefined;
  return isObject(candidate) ? candidate : {};
}

function numberAt(value: unknown, key: string): number | null {
  const raw = isObject(value) ? value[key] : undefined;
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
    ? raw
    : null;
}

function stringAt(value: unknown, key: string): string | null {
  const raw = isObject(value) ? value[key] : undefined;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

const ALLOWED_EVENTS = new Set([
  "installation",
  "installation_repositories",
  "workflow_run",
  "workflow_job",
  "push",
  "pull_request",
]);

async function repositoryBelongsToTeam(
  admin: AdminClient,
  repositoryId: number,
  teamId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("team_repositories")
    .select("github_repo_id")
    .eq("team_id", teamId)
    .eq("github_repo_id", repositoryId)
    .maybeSingle();
  return !error && Boolean(data);
}

async function queueAlerts(
  admin: AdminClient,
  teamId: string,
  runId: number,
  runAttempt: number,
  branch: string | null,
  conclusion: string | null,
): Promise<void> {
  const kind = conclusion === "failure"
    ? "failure"
    : conclusion === "success"
    ? "recovered"
    : null;
  if (!kind) return;

  const { data: rules } = await admin
    .from("alert_rules")
    .select("branches,notify_recovered,skip_flaky")
    .eq("team_id", teamId)
    .maybeSingle();

  const ruleBranches = Array.isArray(rules?.branches)
    ? rules.branches.filter((value): value is string =>
      typeof value === "string"
    )
    : [];
  if (ruleBranches.length > 0 && (!branch || !ruleBranches.includes(branch))) {
    return;
  }
  if (kind === "recovered" && rules?.notify_recovered === false) return;

  const { data: channels } = await admin
    .from("alert_channels")
    .select("id")
    .eq("team_id", teamId)
    .not("verified_at", "is", null);

  if (!channels?.length) return;

  const rows = channels.map((channel) => ({
    team_id: teamId,
    channel_id: channel.id,
    github_run_id: runId,
    kind,
    dedupe_key: [teamId, runId, runAttempt, kind, channel.id].join(":"),
    status: "pending",
  }));

  const { error } = await admin.from("alerts_sent").upsert(rows, {
    onConflict: "team_id,dedupe_key",
    ignoreDuplicates: true,
  });
  if (error) {
    console.error("Could not queue alert deliveries", { code: error.code });
  }
}

async function processWorkflowRun(
  admin: AdminClient,
  teamId: string,
  repositoryId: number,
  payload: JsonObject,
): Promise<void> {
  const run = objectAt(payload, "workflow_run");
  const runId = numberAt(run, "id");
  if (!runId) {
    throw new HttpError(
      400,
      "INVALID_WORKFLOW_RUN",
      "Webhook workflow run identifier is missing.",
    );
  }

  const runAttempt = Math.max(1, numberAt(run, "run_attempt") ?? 1);
  const status = stringAt(run, "status");
  const conclusion = stringAt(run, "conclusion");
  const branch = stringAt(run, "head_branch");

  const { error } = await admin.from("workflow_runs").upsert({
    github_run_id: runId,
    team_id: teamId,
    github_repo_id: repositoryId,
    workflow_name: stringAt(run, "name") ?? "GitHub Actions",
    run_number: numberAt(run, "run_number") ?? 1,
    run_attempt: runAttempt,
    head_branch: branch,
    head_sha: stringAt(run, "head_sha"),
    event: stringAt(run, "event"),
    status,
    conclusion,
    actor_login: stringAt(objectAt(run, "actor"), "login"),
    html_url: stringAt(run, "html_url"),
    run_started_at: stringAt(run, "run_started_at"),
    completed_at: stringAt(run, "updated_at"),
    github_updated_at: stringAt(run, "updated_at"),
  }, { onConflict: "github_run_id" });

  if (error) {
    throw new HttpError(
      500,
      "WORKFLOW_RUN_SAVE_FAILED",
      "Workflow run data could not be saved.",
    );
  }
  if (status === "completed") {
    await queueAlerts(admin, teamId, runId, runAttempt, branch, conclusion);
  }
}

async function processWorkflowJob(
  admin: AdminClient,
  teamId: string,
  payload: JsonObject,
): Promise<void> {
  const job = objectAt(payload, "workflow_job");
  const jobId = numberAt(job, "id");
  const runId = numberAt(job, "run_id");
  if (!jobId || !runId) {
    throw new HttpError(
      400,
      "INVALID_WORKFLOW_JOB",
      "Webhook workflow job identifiers are missing.",
    );
  }

  const { data: parentRun, error: parentError } = await admin
    .from("workflow_runs")
    .select("github_run_id")
    .eq("team_id", teamId)
    .eq("github_run_id", runId)
    .maybeSingle();

  if (parentError || !parentRun) {
    throw new HttpError(
      409,
      "WORKFLOW_RUN_NOT_FOUND",
      "The parent workflow run has not been synchronized yet.",
    );
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const failedStep = steps.find((step) =>
    isObject(step) && step.conclusion === "failure"
  );
  const { error } = await admin.from("workflow_jobs").upsert({
    github_job_id: jobId,
    team_id: teamId,
    github_run_id: runId,
    name: stringAt(job, "name") ?? "GitHub Actions job",
    status: stringAt(job, "status"),
    conclusion: stringAt(job, "conclusion"),
    failed_step_name: isObject(failedStep)
      ? stringAt(failedStep, "name")
      : null,
    started_at: stringAt(job, "started_at"),
    completed_at: stringAt(job, "completed_at"),
  }, { onConflict: "github_job_id" });

  if (error) {
    throw new HttpError(
      500,
      "WORKFLOW_JOB_SAVE_FAILED",
      "Workflow job data could not be saved.",
    );
  }
}

async function processActivity(
  admin: AdminClient,
  teamId: string,
  repositoryId: number,
  deliveryId: string,
  eventType: string,
  payload: JsonObject,
): Promise<void> {
  let kind: "push" | "pr_opened" | "pr_merged" | null = null;
  let title: string | null = null;
  let actor: string | null = null;
  let url: string | null = null;
  let occurredAt = new Date().toISOString();

  if (eventType === "push") {
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    const lastCommit =
      commits.length > 0 && isObject(commits[commits.length - 1])
        ? commits[commits.length - 1]
        : {};
    kind = "push";
    title = stringAt(lastCommit, "message") ?? "Push received";
    actor = stringAt(objectAt(payload, "pusher"), "name");
    const repository = objectAt(payload, "repository");
    const commitSha = stringAt(payload, "after");
    const repositoryUrl = stringAt(repository, "html_url");
    url = commitSha && repositoryUrl
      ? repositoryUrl + "/commit/" + commitSha
      : repositoryUrl;
    occurredAt = stringAt(lastCommit, "timestamp") ?? occurredAt;
  } else if (eventType === "pull_request") {
    const action = stringAt(payload, "action");
    const pullRequest = objectAt(payload, "pull_request");
    if (
      action === "opened" ||
      (action === "closed" && pullRequest.merged === true)
    ) {
      kind = action === "opened" ? "pr_opened" : "pr_merged";
      title = stringAt(pullRequest, "title") ?? "Pull request";
      actor = stringAt(objectAt(pullRequest, "user"), "login");
      url = stringAt(pullRequest, "html_url");
      occurredAt = stringAt(pullRequest, "updated_at") ?? occurredAt;
    }
  }

  if (!kind) return;

  const { error } = await admin.from("activity_events").upsert({
    team_id: teamId,
    github_repo_id: repositoryId,
    kind,
    title: title?.slice(0, 500) ?? null,
    actor_login: actor,
    url,
    occurred_at: occurredAt,
    delivery_id: deliveryId,
  }, { onConflict: "delivery_id,kind", ignoreDuplicates: true });

  if (error) {
    throw new HttpError(
      500,
      "ACTIVITY_SAVE_FAILED",
      "Repository activity could not be saved.",
    );
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const secret = Deno.env.get("GITHUB_WEBHOOK_SECRET")?.trim();
  if (!secret) {
    return jsonResponse(request, { error: "WEBHOOK_NOT_CONFIGURED" }, 503);
  }

  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (rawBody.length > 2_000_000) {
    return jsonResponse(request, { error: "PAYLOAD_TOO_LARGE" }, 413);
  }

  const signatureOk = await verifyGithubWebhookSignature(
    rawBody,
    request.headers.get("x-hub-signature-256"),
    secret,
  );
  if (!signatureOk) {
    return jsonResponse(request, { error: "INVALID_SIGNATURE" }, 401);
  }

  const deliveryId = request.headers.get("x-github-delivery") ?? "";
  const eventType = request.headers.get("x-github-event") ?? "";
  if (
    !deliveryId || deliveryId.length > 100 || !eventType ||
    eventType.length > 100
  ) {
    return jsonResponse(request, { error: "INVALID_WEBHOOK_HEADERS" }, 400);
  }

  let payload: JsonObject;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(rawBody));
    if (!isObject(parsed)) throw new Error("Payload is not an object.");
    payload = parsed;
  } catch {
    return jsonResponse(request, { error: "INVALID_WEBHOOK_JSON" }, 400);
  }

  if (!ALLOWED_EVENTS.has(eventType)) {
    return jsonResponse(request, { ok: true, ignored: true });
  }

  let admin: AdminClient;
  try {
    admin = createAdminClient();
  } catch {
    return jsonResponse(
      request,
      { error: "WEBHOOK_SERVER_NOT_CONFIGURED" },
      503,
    );
  }

  const installationId = numberAt(objectAt(payload, "installation"), "id");
  const repositoryId = numberAt(objectAt(payload, "repository"), "id");
  const digest = await crypto.subtle.digest("SHA-256", rawBody);
  const payloadHash = Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");

  const { error: deliveryError } = await admin.from("webhook_events").insert({
    delivery_id: deliveryId,
    event_type: eventType,
    action: stringAt(payload, "action"),
    installation_id: installationId,
    github_repo_id: repositoryId,
    payload_sha256: payloadHash,
    status: "received",
  });

  let deliveryAttempt = 1;
  if (deliveryError?.code === "23505") {
    const { data: existingDelivery, error: lookupError } = await admin
      .from("webhook_events")
      .select("status,attempts")
      .eq("delivery_id", deliveryId)
      .maybeSingle();
    if (lookupError || !existingDelivery) {
      return jsonResponse(
        request,
        { error: "WEBHOOK_DUPLICATE_LOOKUP_FAILED" },
        500,
      );
    }
    if (
      existingDelivery.status === "processed" ||
      existingDelivery.status === "unmatched"
    ) {
      return jsonResponse(request, { ok: true, duplicate: true });
    }
    deliveryAttempt = Number(existingDelivery.attempts ?? 0) + 1;
    const { data: retryClaim, error: retryError } = await admin
      .from("webhook_events")
      .update({
        status: "received",
        attempts: deliveryAttempt,
        last_error: null,
      })
      .eq("delivery_id", deliveryId)
      .in("status", ["failed", "received"])
      .select("delivery_id")
      .maybeSingle();
    if (retryError || !retryClaim) {
      return jsonResponse(request, { ok: true, duplicate: true });
    }
  } else if (deliveryError) {
    return jsonResponse(request, { error: "WEBHOOK_RECEIVE_FAILED" }, 500);
  }

  try {
    if (eventType === "installation") {
      const action = stringAt(payload, "action");
      if (
        installationId &&
        (action === "deleted" || action === "suspend" || action === "unsuspend")
      ) {
        const changes = action === "deleted"
          ? { deleted_at: new Date().toISOString() }
          : action === "suspend"
          ? { suspended_at: new Date().toISOString() }
          : { suspended_at: null };
        const { error } = await admin.from("github_installations").update(
          changes,
        ).eq("installation_id", installationId);
        if (error) {
          throw new HttpError(
            500,
            "INSTALLATION_STATE_UPDATE_FAILED",
            "Installation status could not be updated.",
          );
        }
      }
      await admin.from("webhook_events").update({
        status: "processed",
        processed_at: new Date().toISOString(),
      }).eq("delivery_id", deliveryId);
      return jsonResponse(request, { ok: true });
    }

    if (!installationId) {
      await admin.from("webhook_events").update({
        status: "unmatched",
        last_error: "INSTALLATION_ID_MISSING",
      }).eq("delivery_id", deliveryId);
      return jsonResponse(request, { ok: true, unmatched: true });
    }

    const { data: installation, error: installationError } = await admin
      .from("github_installations")
      .select("installation_id,team_id")
      .eq("installation_id", installationId)
      .is("deleted_at", null)
      .maybeSingle();

    if (installationError || !installation) {
      await admin.from("webhook_events").update({
        status: "unmatched",
        last_error: "INSTALLATION_NOT_MAPPED",
      }).eq("delivery_id", deliveryId);
      return jsonResponse(request, { ok: true, unmatched: true });
    }

    if (eventType === "workflow_run") {
      if (
        !repositoryId ||
        !(await repositoryBelongsToTeam(
          admin,
          repositoryId,
          installation.team_id,
        ))
      ) {
        throw new HttpError(
          409,
          "REPOSITORY_NOT_MAPPED",
          "Repository mapping is not available yet.",
        );
      }
      await processWorkflowRun(
        admin,
        installation.team_id,
        repositoryId,
        payload,
      );
    } else if (eventType === "workflow_job") {
      await processWorkflowJob(admin, installation.team_id, payload);
    } else if (eventType === "push" || eventType === "pull_request") {
      if (
        !repositoryId ||
        !(await repositoryBelongsToTeam(
          admin,
          repositoryId,
          installation.team_id,
        ))
      ) {
        throw new HttpError(
          409,
          "REPOSITORY_NOT_MAPPED",
          "Repository mapping is not available yet.",
        );
      }
      await processActivity(
        admin,
        installation.team_id,
        repositoryId,
        deliveryId,
        eventType,
        payload,
      );
    }

    await admin.from("webhook_events")
      .update({
        status: "processed",
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("delivery_id", deliveryId);

    return jsonResponse(request, { ok: true });
  } catch (error) {
    await admin.from("webhook_events").update({
      status: "failed",
      attempts: deliveryAttempt,
      last_error: error instanceof HttpError ? error.code : "PROCESSING_FAILED",
    }).eq("delivery_id", deliveryId);
    return jsonResponse(request, { error: "WEBHOOK_PROCESSING_FAILED" }, 500);
  }
});
