import { createAdminClient } from "../_shared/auth.ts";
import { HttpError, jsonResponse, readRequestBytes } from "../_shared/http.ts";
import { verifyGithubWebhookSignature } from "../_shared/webhook-security.ts";
import { isFlakyWorkflowAttempts } from "../_shared/workflow-attempts.ts";
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

function branchMatches(pattern: string, branch: string): boolean {
  const special = ".+?^$(){}|[]\\";
  let regex = "^";
  for (const character of pattern) {
    if (character === "*") regex += ".*";
    else regex += special.includes(character) ? "\\" + character : character;
  }
  return new RegExp(regex + "$").test(branch);
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

  const { data: rules, error: rulesError } = await admin
    .from("alert_rules")
    .select("branches,notify_recovered,skip_flaky")
    .eq("team_id", teamId)
    .maybeSingle();
  if (rulesError) {
    throw new HttpError(
      500,
      "ALERT_RULE_LOOKUP_FAILED",
      "Alert preferences could not be loaded.",
    );
  }

  const ruleBranches = Array.isArray(rules?.branches)
    ? rules.branches.filter((value): value is string =>
      typeof value === "string"
    )
    : [];
  if (
    ruleBranches.length > 0 &&
    (!branch || !ruleBranches.some((pattern) => branchMatches(pattern, branch)))
  ) {
    return;
  }
  if (kind === "recovered" && rules?.notify_recovered === false) return;

  const { data: channels, error: channelsError } = await admin
    .from("alert_channels")
    .select("id")
    .eq("team_id", teamId)
    .not("verified_at", "is", null);
  if (channelsError) {
    throw new HttpError(
      500,
      "ALERT_CHANNEL_LOOKUP_FAILED",
      "Verified alert destinations could not be loaded.",
    );
  }

  if (!channels?.length) return;

  const skipFlaky = rules?.skip_flaky !== false;
  const availableAt = kind === "failure" && skipFlaky
    ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
    : new Date().toISOString();
  const rows = channels.map((channel) => ({
    team_id: teamId,
    channel_id: channel.id,
    github_run_id: runId,
    kind,
    dedupe_key: [teamId, runId, runAttempt, kind, channel.id].join(":"),
    status: "pending",
    available_at: availableAt,
  }));

  const { error } = await admin.from("alerts_sent").upsert(rows, {
    onConflict: "team_id,dedupe_key",
    ignoreDuplicates: true,
  });
  if (error) {
    throw new HttpError(
      500,
      "ALERT_QUEUE_SAVE_FAILED",
      "Workflow alert deliveries could not be queued.",
    );
  }
}

async function saveWorkflowJob(
  admin: AdminClient,
  teamId: string,
  runId: number,
  job: JsonObject,
): Promise<void> {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const failedStep = steps.find((step) =>
    isObject(step) && step.conclusion === "failure"
  );
  const { error } = await admin.from("workflow_jobs").upsert({
    github_job_id: numberAt(job, "id"),
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

async function reconcilePendingWorkflowJobs(
  admin: AdminClient,
  teamId: string,
  runId: number,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: pending, error } = await admin
    .from("pending_workflow_jobs")
    .select(
      "github_job_id,name,status,conclusion,failed_step_name,started_at,completed_at",
    )
    .eq("team_id", teamId)
    .eq("github_run_id", runId)
    .gt("expires_at", now)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) {
    throw new HttpError(
      500,
      "PENDING_WORKFLOW_JOBS_LOOKUP_FAILED",
      "Pending workflow jobs could not be reconciled.",
    );
  }

  for (const pendingJob of pending ?? []) {
    await saveWorkflowJob(admin, teamId, runId, {
      id: pendingJob.github_job_id,
      name: pendingJob.name,
      status: pendingJob.status,
      conclusion: pendingJob.conclusion,
      steps: pendingJob.failed_step_name
        ? [{ name: pendingJob.failed_step_name, conclusion: "failure" }]
        : [],
      started_at: pendingJob.started_at,
      completed_at: pendingJob.completed_at,
    });
    const { error: deleteError } = await admin
      .from("pending_workflow_jobs")
      .delete()
      .eq("github_job_id", pendingJob.github_job_id)
      .eq("team_id", teamId);
    if (deleteError) {
      throw new HttpError(
        500,
        "PENDING_WORKFLOW_JOB_DELETE_FAILED",
        "A reconciled workflow job could not be finalized.",
      );
    }
  }

  const { error: expiryError } = await admin
    .from("pending_workflow_jobs")
    .delete()
    .eq("team_id", teamId)
    .lte("expires_at", now);
  if (expiryError) {
    throw new HttpError(
      500,
      "PENDING_WORKFLOW_JOB_CLEANUP_FAILED",
      "Expired pending workflow jobs could not be cleaned up.",
    );
  }
}

async function reconcileFlakyRun(
  admin: AdminClient,
  teamId: string,
  runId: number,
): Promise<void> {
  const { data: attempts, error } = await admin
    .from("workflow_run_attempts")
    .select("run_attempt,status,conclusion")
    .eq("team_id", teamId)
    .eq("github_run_id", runId)
    .order("run_attempt", { ascending: true });

  if (error) {
    throw new HttpError(
      500,
      "WORKFLOW_ATTEMPTS_LOOKUP_FAILED",
      "Workflow retry history could not be checked.",
    );
  }

  const isFlaky = isFlakyWorkflowAttempts(attempts ?? []);

  const { error: runError } = await admin
    .from("workflow_runs")
    .update({ is_flaky: isFlaky })
    .eq("team_id", teamId)
    .eq("github_run_id", runId);
  if (runError) {
    throw new HttpError(
      500,
      "FLAKY_RUN_CLASSIFICATION_FAILED",
      "Workflow retry classification could not be saved.",
    );
  }
  if (!isFlaky) return;

  const { data: rules, error: ruleError } = await admin
    .from("alert_rules")
    .select("skip_flaky")
    .eq("team_id", teamId)
    .maybeSingle();
  if (ruleError) {
    throw new HttpError(
      500,
      "FLAKY_ALERT_RULE_LOOKUP_FAILED",
      "Flaky alert preferences could not be loaded.",
    );
  }
  if (rules?.skip_flaky === false) return;

  // A delivery already in the provider's sending phase cannot be recalled.
  // Pending/pre-send claims are safely suppressed; the dispatcher rechecks status.
  const { error: skipError } = await admin
    .from("alerts_sent")
    .update({
      status: "skipped",
      failure_code: "SKIPPED_FLAKY_RUN",
    })
    .eq("team_id", teamId)
    .eq("github_run_id", runId)
    .eq("kind", "failure")
    .in("status", ["pending", "processing", "failed"]);
  if (skipError) {
    throw new HttpError(
      500,
      "FLAKY_ALERT_SUPPRESSION_FAILED",
      "Pending flaky-run alerts could not be suppressed.",
    );
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
  const githubUpdatedAt = stringAt(run, "updated_at");

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
    completed_at: stringAt(run, "completed_at"),
    github_updated_at: githubUpdatedAt,
  }, { onConflict: "github_run_id" });

  if (error) {
    throw new HttpError(
      500,
      "WORKFLOW_RUN_SAVE_FAILED",
      "Workflow run data could not be saved.",
    );
  }

  const { error: attemptError } = await admin
    .from("workflow_run_attempts")
    .upsert({
      github_run_id: runId,
      team_id: teamId,
      run_attempt: runAttempt,
      status,
      conclusion,
      completed_at: stringAt(run, "completed_at"),
      github_updated_at: githubUpdatedAt,
    }, { onConflict: "github_run_id,run_attempt" });
  if (attemptError) {
    throw new HttpError(
      500,
      "WORKFLOW_ATTEMPT_SAVE_FAILED",
      "Workflow attempt history could not be saved.",
    );
  }

  await reconcilePendingWorkflowJobs(admin, teamId, runId);
  if (status === "completed") {
    await queueAlerts(admin, teamId, runId, runAttempt, branch, conclusion);
    await reconcileFlakyRun(admin, teamId, runId);
  }
}

async function processWorkflowJob(
  admin: AdminClient,
  teamId: string,
  deliveryId: string,
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

  if (parentError) {
    throw new HttpError(
      500,
      "WORKFLOW_RUN_LOOKUP_FAILED",
      "The parent workflow run could not be checked.",
    );
  }
  if (parentRun) {
    await saveWorkflowJob(admin, teamId, runId, job);
    const { error: pendingDeleteError } = await admin
      .from("pending_workflow_jobs")
      .delete()
      .eq("github_job_id", jobId)
      .eq("team_id", teamId);
    if (pendingDeleteError) {
      throw new HttpError(
        500,
        "PENDING_WORKFLOW_JOB_DELETE_FAILED",
        "A previously queued workflow job could not be finalized.",
      );
    }
    return;
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const failedStep = steps.find((step) =>
    isObject(step) && step.conclusion === "failure"
  );
  const { error: pendingError } = await admin
    .from("pending_workflow_jobs")
    .upsert({
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
      source_delivery_id: deliveryId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: "github_job_id" });
  if (pendingError) {
    throw new HttpError(
      500,
      "PENDING_WORKFLOW_JOB_SAVE_FAILED",
      "The out-of-order workflow job could not be queued.",
    );
  }

  // Close the race where the parent run is created between the first lookup
  // and insertion of the pending child event.
  const { data: recheckedParent, error: recheckError } = await admin
    .from("workflow_runs")
    .select("github_run_id")
    .eq("team_id", teamId)
    .eq("github_run_id", runId)
    .maybeSingle();
  if (recheckError) {
    throw new HttpError(
      500,
      "WORKFLOW_RUN_RECHECK_FAILED",
      "The parent workflow run could not be rechecked.",
    );
  }
  if (recheckedParent) {
    await saveWorkflowJob(admin, teamId, runId, job);
    const { error: deleteError } = await admin
      .from("pending_workflow_jobs")
      .delete()
      .eq("github_job_id", jobId)
      .eq("team_id", teamId);
    if (deleteError) {
      throw new HttpError(
        500,
        "PENDING_WORKFLOW_JOB_DELETE_FAILED",
        "A reconciled workflow job could not be finalized.",
      );
    }
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

  let rawBody: Uint8Array;
  try {
    rawBody = await readRequestBytes(request, 2_000_000);
  } catch (error) {
    if (error instanceof HttpError && error.status === 413) {
      return jsonResponse(request, { error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    return jsonResponse(request, { error: "WEBHOOK_BODY_READ_FAILED" }, 400);
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
  const digestBuffer = new ArrayBuffer(rawBody.byteLength);
  new Uint8Array(digestBuffer).set(rawBody);
  const digest = await crypto.subtle.digest("SHA-256", digestBuffer);
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
    status: "processing",
    attempts: 1,
    processing_started_at: new Date().toISOString(),
  });

  let deliveryAttempt = 1;
  if (deliveryError?.code === "23505") {
    const { data: existingDelivery, error: lookupError } = await admin
      .from("webhook_events")
      .select("status,attempts,processing_started_at,dead")
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
      existingDelivery.status === "unmatched" ||
      existingDelivery.dead
    ) {
      return jsonResponse(request, { ok: true, duplicate: true });
    }

    const nowMs = Date.now();
    const processingStartedAt = existingDelivery.processing_started_at
      ? Date.parse(existingDelivery.processing_started_at)
      : 0;
    const currentlyProcessing = existingDelivery.status === "processing" &&
      Number.isFinite(processingStartedAt) &&
      nowMs - processingStartedAt < 5 * 60 * 1000;
    if (currentlyProcessing) {
      return jsonResponse(request, {
        ok: true,
        duplicate: true,
        processing: true,
      });
    }

    const currentAttempts = Number(existingDelivery.attempts ?? 0);
    if (currentAttempts >= 8) {
      await admin.from("webhook_events")
        .update({ dead: true })
        .eq("delivery_id", deliveryId)
        .eq("attempts", currentAttempts);
      return jsonResponse(request, { ok: true, dead_lettered: true });
    }

    deliveryAttempt = currentAttempts + 1;
    const { data: retryClaim, error: retryError } = await admin
      .from("webhook_events")
      .update({
        status: "processing",
        attempts: deliveryAttempt,
        processing_started_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("delivery_id", deliveryId)
      .eq("status", existingDelivery.status)
      .eq("attempts", currentAttempts)
      .select("delivery_id")
      .maybeSingle();
    if (retryError || !retryClaim) {
      return jsonResponse(request, {
        ok: true,
        duplicate: true,
        processing: true,
      });
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

    if (eventType === "installation_repositories") {
      const added = Array.isArray(payload.repositories_added)
        ? payload.repositories_added
        : [];
      const removed = Array.isArray(payload.repositories_removed)
        ? payload.repositories_removed
        : [];
      const syncedAt = new Date().toISOString();

      const removedIds = removed
        .map((repository) => numberAt(repository, "id"))
        .filter((id): id is number => id !== null);
      if (removedIds.length > 0) {
        const { error } = await admin.from("team_repositories")
          .update({ active: false, last_synced_at: syncedAt })
          .eq("team_id", installation.team_id)
          .eq("installation_id", installationId)
          .in("github_repo_id", removedIds);
        if (error) {
          throw new HttpError(
            500,
            "GITHUB_REPOSITORY_REMOVE_FAILED",
            "Removed GitHub repositories could not be reconciled.",
          );
        }
      }

      const addedRows = added.flatMap((value) => {
        if (!isObject(value)) return [];
        const id = numberAt(value, "id");
        const fullName = stringAt(value, "full_name");
        if (!id || !fullName) return [];
        return [{
          github_repo_id: id,
          team_id: installation.team_id,
          installation_id: installationId,
          full_name: fullName,
          default_branch: stringAt(value, "default_branch"),
          is_private: value.private === true,
          archived: value.archived === true,
          active: true,
          last_synced_at: syncedAt,
        }];
      });
      if (addedRows.length > 0) {
        const { error } = await admin.from("team_repositories")
          .upsert(addedRows, { onConflict: "github_repo_id" });
        if (error) {
          throw new HttpError(
            500,
            "GITHUB_REPOSITORY_ADD_FAILED",
            "New GitHub repositories could not be reconciled.",
          );
        }
      }

      const { error: installError } = await admin.from("github_installations")
        .update({ last_reconciled_at: syncedAt })
        .eq("installation_id", installationId)
        .eq("team_id", installation.team_id);
      if (installError) {
        throw new HttpError(
          500,
          "GITHUB_INSTALLATION_RECONCILE_FAILED",
          "GitHub installation state could not be reconciled.",
        );
      }
    } else if (eventType === "workflow_run") {
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
      await processWorkflowJob(
        admin,
        installation.team_id,
        deliveryId,
        payload,
      );
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
      dead: deliveryAttempt >= 8,
      last_error: error instanceof HttpError ? error.code : "PROCESSING_FAILED",
    }).eq("delivery_id", deliveryId);
    return jsonResponse(request, { error: "WEBHOOK_PROCESSING_FAILED" }, 500);
  }
});
