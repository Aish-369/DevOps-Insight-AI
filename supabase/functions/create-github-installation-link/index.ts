import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";
import { requireAuth, requireTeamRole } from "../_shared/auth.ts";
import { randomToken, sha256Hex } from "../_shared/security.ts";

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
    const appSlug = Deno.env.get("GITHUB_APP_SLUG")?.trim();
    if (
      !appSlug || !Deno.env.get("GITHUB_APP_ID") ||
      !Deno.env.get("GITHUB_APP_PRIVATE_KEY")
    ) {
      throw new HttpError(
        503,
        "GITHUB_APP_NOT_CONFIGURED",
        "GitHub App integration is not configured.",
      );
    }

    const state = randomToken(32);
    const stateHash = await sha256Hex(state);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await context.admin.from("github_installation_states")
      .insert({
        team_id: teamId,
        user_id: context.user.id,
        state_hash: stateHash,
        expires_at: expiresAt,
      });
    if (error) {
      throw new HttpError(
        500,
        "GITHUB_STATE_CREATE_FAILED",
        "The GitHub installation request could not be started.",
      );
    }

    const installUrl = new URL(
      "https://github.com/apps/" + encodeURIComponent(appSlug) +
        "/installations/new",
    );
    installUrl.searchParams.set("state", state);

    return jsonResponse(request, {
      ok: true,
      install_url: installUrl.toString(),
      expires_at: expiresAt,
    });
  } catch (error) {
    return handleError(request, error);
  }
});
