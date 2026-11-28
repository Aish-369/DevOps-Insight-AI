import { createInstallationToken } from "../_shared/github.ts";
import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import {
  assertAllowedOrigin,
  fetchWithTimeout,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
  readResponseBytes,
} from "../_shared/http.ts";
import { redactSecrets, sha256Hex } from "../_shared/security.ts";
import { unzipSync } from "fflate";
import { getActiveRepositoryMapping } from "../_shared/repository-access.ts";
import { analyzeLogsWithRules } from "../_shared/rule-analysis.ts";

const MAX_LOG_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_LOG_TEXT_CHARS = 120_000;
const MAX_LOG_ENTRY_BYTES = 1_000_000;
const MAX_LOG_ARCHIVE_FILES = 200;
const MAX_LOG_TOTAL_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const ANALYSIS_PROMPT_VERSION = "ci-rules-v1";

async function fetchRunLogs(
  installationId: number,
  repository: string,
  runId: number,
): Promise<string> {
  const token = await createInstallationToken(installationId);
  const response = await fetchWithTimeout(
    "https://api.github.com/repos/" + repository + "/actions/runs/" + runId +
      "/logs",
    {
      headers: {
        authorization: "Bearer " + token,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      redirect: "follow",
    },
    20_000,
  );

  if (!response.ok) {
    console.error("GitHub run logs request failed", {
      status: response.status,
      runId,
    });
    throw new HttpError(
      502,
      "GITHUB_LOGS_UNAVAILABLE",
      "GitHub workflow logs are not available for this run.",
    );
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > MAX_LOG_ARCHIVE_BYTES) {
    throw new HttpError(
      413,
      "GITHUB_LOG_ARCHIVE_TOO_LARGE",
      "The workflow log archive exceeds the analysis size limit.",
    );
  }

  const archive = await readResponseBytes(
    response,
    MAX_LOG_ARCHIVE_BYTES,
    "GITHUB_LOG_ARCHIVE_TOO_LARGE",
  );
  if (archive.byteLength === 0) {
    throw new HttpError(
      413,
      "GITHUB_LOG_ARCHIVE_TOO_LARGE",
      "The workflow log archive is empty or exceeds the analysis size limit.",
    );
  }

  let files: Record<string, Uint8Array>;
  let archiveFileCount = 0;
  let totalUncompressedBytes = 0;
  try {
    files = unzipSync(archive, {
      filter: (file) => {
        archiveFileCount += 1;
        totalUncompressedBytes += file.originalSize;
        if (
          archiveFileCount > MAX_LOG_ARCHIVE_FILES ||
          totalUncompressedBytes > MAX_LOG_TOTAL_UNCOMPRESSED_BYTES
        ) {
          throw new HttpError(
            413,
            "GITHUB_LOG_ARCHIVE_EXPANSION_LIMIT",
            "The workflow log archive expands beyond the analysis safety limit.",
          );
        }
        return file.originalSize <= MAX_LOG_ENTRY_BYTES &&
          /\.txt$/i.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      "GITHUB_LOG_ARCHIVE_INVALID",
      "GitHub returned an unreadable workflow log archive.",
    );
  }

  const parts: string[] = [];
  let totalChars = 0;
  for (const name of Object.keys(files).sort()) {
    const file = files[name];
    if (!file || file.byteLength > MAX_LOG_ENTRY_BYTES) continue;
    const text = new TextDecoder().decode(file);
    const remaining = MAX_LOG_TEXT_CHARS - totalChars;
    if (remaining <= 0) break;
    const excerpt = text.slice(-remaining);
    parts.push("### " + name + "\n" + excerpt);
    totalChars += excerpt.length;
  }

  if (parts.length === 0) {
    throw new HttpError(
      422,
      "GITHUB_LOGS_EMPTY",
      "This workflow run does not contain readable text logs.",
    );
  }

  return redactSecrets(parts.join("\n\n")).slice(-MAX_LOG_TEXT_CHARS);
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

    const context = await requireAuth(request);
    const body = await readJsonObject(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    const runId = Number(body.run_id);
    const jobId = body.job_id === undefined || body.job_id === null
      ? null
      : Number(body.job_id);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(teamId) ||
      !Number.isSafeInteger(runId) || runId <= 0 ||
      (jobId !== null && (!Number.isSafeInteger(jobId) || jobId <= 0))
    ) {
      throw new HttpError(
        400,
        "INVALID_REQUEST",
        "A valid team, run and optional job ID are required.",
      );
    }

    await requireTeamRole(context, teamId, ["owner", "admin", "member"]);
    const { data: run, error: runError } = await context.admin
      .from("workflow_runs")
      .select("github_run_id,team_id,github_repo_id,conclusion,status,head_sha")
      .eq("team_id", teamId)
      .eq("github_run_id", runId)
      .maybeSingle();

    if (runError || !run) {
      throw new HttpError(
        404,
        "WORKFLOW_RUN_NOT_FOUND",
        "The workflow run was not found for this team.",
      );
    }
    if (run.status !== "completed" || run.conclusion === "success") {
      throw new HttpError(
        409,
        "RUN_NOT_ANALYZABLE",
        "Only completed unsuccessful workflow runs can be analyzed.",
      );
    }

    let installationId = 0;
    const repository = await getActiveRepositoryMapping(
      context.admin,
      teamId,
      Number(run.github_repo_id),
    );

    if (!repository) {
      throw new HttpError(
        404,
        "REPOSITORY_NOT_FOUND",
        "The repository installation was not found.",
      );
    }
    installationId = Number(repository.installation_id);

    if (jobId !== null) {
      const { data, error } = await context.admin
        .from("workflow_jobs")
        .select("github_job_id,name,conclusion,failed_step_name")
        .eq("team_id", teamId)
        .eq("github_run_id", runId)
        .eq("github_job_id", jobId)
        .maybeSingle();
      if (error || !data) {
        throw new HttpError(
          404,
          "WORKFLOW_JOB_NOT_FOUND",
          "The workflow job was not found for this team run.",
        );
      }
    }

    const logText = await fetchRunLogs(
      installationId,
      repository.full_name,
      runId,
    );
    const signature = await sha256Hex(
      [
        ANALYSIS_PROMPT_VERSION,
        teamId,
        runId,
        jobId ?? "all",
        logText,
      ].join(":"),
    );
    const { data: previous } = await context.admin
      .from("failure_analyses")
      .select(
        "id,category,cause,fix_steps,evidence,confidence,model,created_at",
      )
      .eq("team_id", teamId)
      .eq("signature", signature)
      .eq("status", "done")
      .maybeSingle();

    if (previous) {
      return jsonResponse(request, {
        ok: true,
        reused: true,
        analysis: previous,
      });
    }

    const { data: quotaClaimed, error: quotaError } = await context.admin.rpc(
      "claim_team_ai_analysis",
      {
        p_team_id: teamId,
      },
    );
    if (quotaError) {
      throw new HttpError(
        500,
        "AI_USAGE_CLAIM_FAILED",
        "The team's AI analysis allowance could not be reserved.",
      );
    }
    if (quotaClaimed !== true) {
      throw new HttpError(
        429,
        "AI_DAILY_CAP_REACHED",
        "This team has reached its daily AI analysis limit.",
      );
    }

    // Zero-cost deterministic diagnostics: no external AI provider or API key.
    const analysis = analyzeLogsWithRules(logText);
    const model = "rules-v1";
    const tokensIn: number | null = null;
    const tokensOut: number | null = null;
    const { data: saved, error: saveError } = await context.admin.from(
      "failure_analyses",
    ).insert({
      team_id: teamId,
      github_run_id: runId,
      github_job_id: jobId,
      signature,
      status: "done",
      category: analysis.category,
      cause: analysis.cause,
      fix_steps: analysis.fix_steps,
      evidence: analysis.evidence,
      confidence: analysis.confidence,
      model,
      prompt_version: ANALYSIS_PROMPT_VERSION,
      tokens_in: Number.isSafeInteger(tokensIn) && (tokensIn ?? -1) >= 0
        ? tokensIn
        : null,
      tokens_out: Number.isSafeInteger(tokensOut) && (tokensOut ?? -1) >= 0
        ? tokensOut
        : null,
      completed_at: new Date().toISOString(),
    }).select(
      "id,category,cause,fix_steps,evidence,confidence,model,created_at",
    ).single();

    if (saveError || !saved) {
      throw new HttpError(
        500,
        "ANALYSIS_SAVE_FAILED",
        "The analysis result could not be saved.",
      );
    }

    await writeAudit(
      context.admin,
      teamId,
      context.user.id,
      "ai.failure_analysis.completed",
      {
        analysis_id: saved.id,
        github_run_id: runId,
        confidence: analysis.confidence,
      },
    );

    return jsonResponse(
      request,
      { ok: true, reused: false, analysis: saved },
      201,
    );
  } catch (error) {
    return handleError(request, error);
  }
});
