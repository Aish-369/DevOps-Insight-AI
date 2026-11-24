import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";
import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import { githubAppRequest } from "../_shared/github.ts";
import { sha256Hex } from "../_shared/security.ts";

type GithubInstallation = {
  id: number;
  account?: { login?: string; type?: string };
  repository_selection?: string;
  suspended_at?: string | null;
};

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
    const state = typeof body.state === "string" ? body.state.trim() : "";
    const installationId = Number(body.installation_id);

    if (
      !/^[0-9a-f]{64}$/i.test(state) || !Number.isSafeInteger(installationId) ||
      installationId <= 0
    ) {
      throw new HttpError(
        400,
        "INVALID_INSTALLATION_CALLBACK",
        "The GitHub installation response is invalid.",
      );
    }

    const stateHash = await sha256Hex(state);
    const { data: stateRecord, error: stateError } = await context.admin
      .from("github_installation_states")
      .select("id,team_id,user_id,expires_at,consumed_at")
      .eq("state_hash", stateHash)
      .eq("user_id", context.user.id)
      .maybeSingle();

    if (
      stateError || !stateRecord || stateRecord.consumed_at ||
      Date.parse(stateRecord.expires_at) <= Date.now()
    ) {
      throw new HttpError(
        400,
        "INSTALLATION_STATE_INVALID",
        "The GitHub installation request is invalid or expired. Start again.",
      );
    }

    await requireTeamRole(context, stateRecord.team_id);

    const { data: existingInstallation, error: existingError } = await context
      .admin
      .from("github_installations")
      .select("installation_id,team_id")
      .eq("installation_id", installationId)
      .maybeSingle();

    if (existingError) {
      throw new HttpError(
        500,
        "INSTALLATION_LOOKUP_FAILED",
        "The GitHub installation could not be checked.",
      );
    }
    if (
      existingInstallation &&
      existingInstallation.team_id !== stateRecord.team_id
    ) {
      throw new HttpError(
        409,
        "INSTALLATION_ALREADY_LINKED",
        "This GitHub App installation is already connected to another workspace.",
      );
    }

    const installation = await githubAppRequest<GithubInstallation>(
      "/app/installations/" + installationId,
    );
    if (
      installation.id !== installationId ||
      !installation.account?.login ||
      !installation.account.type
    ) {
      throw new HttpError(
        400,
        "INSTALLATION_NOT_FOUND",
        "GitHub did not return a valid installation.",
      );
    }

    const { error: upsertError } = await context.admin.from(
      "github_installations",
    ).upsert({
      installation_id: installation.id,
      team_id: stateRecord.team_id,
      account_login: installation.account.login,
      account_type: installation.account.type,
      repository_selection: installation.repository_selection ?? "selected",
      suspended_at: installation.suspended_at ?? null,
      deleted_at: null,
      created_by: context.user.id,
      last_reconciled_at: new Date().toISOString(),
    }, { onConflict: "installation_id" });

    if (upsertError) {
      throw new HttpError(
        500,
        "INSTALLATION_SAVE_FAILED",
        "The GitHub installation could not be saved.",
      );
    }

    const { error: consumeError } = await context.admin
      .from("github_installation_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", stateRecord.id)
      .is("consumed_at", null);
    if (consumeError) {
      throw new HttpError(
        500,
        "INSTALLATION_STATE_UPDATE_FAILED",
        "The installation state could not be completed.",
      );
    }

    await writeAudit(
      context.admin,
      stateRecord.team_id,
      context.user.id,
      "github.installation.connected",
      {
        installation_id: installation.id,
        account_login: installation.account.login,
        account_type: installation.account.type,
      },
    );

    return jsonResponse(request, {
      ok: true,
      team_id: stateRecord.team_id,
      installation_id: installation.id,
      account_login: installation.account.login,
      account_type: installation.account.type,
      repository_selection: installation.repository_selection ?? "selected",
    }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
