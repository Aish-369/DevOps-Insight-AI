import { assertAllowedOrigin, handleError, HttpError, jsonResponse, preflight, readJsonObject } from "../_shared/http.ts";
import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import { createInstallationToken, githubInstallationRequest } from "../_shared/github.ts";

type GithubRepository = {
  id: number;
  full_name: string;
  default_branch?: string | null;
  private?: boolean;
  archived?: boolean;
};

type GithubRepositoryPage = {
  total_count: number;
  repositories: GithubRepository[];
};

Deno.serve(async (request: Request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this operation.");
    }

    const context = await requireAuth(request);
    const body = await readJsonObject(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    const installationId = Number(body.installation_id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(teamId) ||
        !Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new HttpError(400, "INVALID_REQUEST", "A valid team and installation ID are required.");
    }

    await requireTeamRole(context, teamId);
    const { data: installation, error } = await context.admin
      .from("github_installations")
      .select("installation_id,team_id,account_login,repository_selection")
      .eq("team_id", teamId)
      .eq("installation_id", installationId)
      .is("suspended_at", null)
      .is("deleted_at", null)
      .maybeSingle();

    if (error || !installation) {
      throw new HttpError(404, "INSTALLATION_NOT_FOUND", "The active GitHub installation was not found for this team.");
    }

    const token = await createInstallationToken(installationId);
    const repositories: GithubRepository[] = [];
    let page = 1;
    let expectedTotal = Number.MAX_SAFE_INTEGER;

    while (repositories.length < expectedTotal && page <= 50) {
      const result = await githubInstallationRequest<GithubRepositoryPage>(
        token,
        "/installation/repositories?per_page=100&page=" + page,
      );
      const pageRepositories = result.data.repositories ?? [];
      if (!Array.isArray(pageRepositories)) {
        throw new HttpError(502, "GITHUB_REPOSITORY_RESPONSE_INVALID", "GitHub returned an invalid repository list.");
      }
      expectedTotal = Number.isSafeInteger(result.data.total_count)
        ? result.data.total_count
        : repositories.length + pageRepositories.length;
      repositories.push(...pageRepositories);
      if (!result.nextPage || pageRepositories.length === 0) break;
      page += 1;
    }

    if (repositories.length < expectedTotal && page > 50) {
      throw new HttpError(502, "GITHUB_REPOSITORY_LIMIT", "The installation has too many repositories for one sync operation.");
    }

    const syncedAt = new Date().toISOString();
    const rows = repositories.map((repository) => ({
      github_repo_id: repository.id,
      team_id: teamId,
      installation_id: installationId,
      full_name: repository.full_name,
      default_branch: repository.default_branch ?? null,
      is_private: Boolean(repository.private),
      archived: Boolean(repository.archived),
      active: true,
      last_synced_at: syncedAt,
    }));

    if (rows.length > 0) {
      const { error: saveError } = await context.admin
        .from("team_repositories")
        .upsert(rows, { onConflict: "github_repo_id" });
      if (saveError) throw new HttpError(500, "REPOSITORY_SYNC_FAILED", "Repository data could not be saved.");
    }

    const { error: reconcileError } = await context.admin
      .from("github_installations")
      .update({ last_reconciled_at: syncedAt })
      .eq("installation_id", installationId)
      .eq("team_id", teamId);
    if (reconcileError) throw new HttpError(500, "INSTALLATION_UPDATE_FAILED", "Installation sync status could not be saved.");

    await writeAudit(context.admin, teamId, context.user.id, "github.repositories.synced", {
      installation_id: installationId,
      repository_count: rows.length,
    });

    return jsonResponse(request, {
      ok: true,
      installation_id: installationId,
      repository_count: rows.length,
      synced_at: syncedAt,
      partial: repositories.length < expectedTotal,
    });
  } catch (error) {
    return handleError(request, error);
  }
});
