import type { SupabaseClient } from "@supabase/supabase-js";

export interface ActiveRepositoryMapping {
  github_repo_id: number;
  installation_id: number;
  full_name: string;
}

/**
 * Returns only an active repository mapping belonging to the requested team.
 * When supplied, installationId is also enforced so a webhook from one
 * installation cannot use a repository mapped through another installation.
 */
export async function getActiveRepositoryMapping(
  admin: SupabaseClient,
  teamId: string,
  repositoryId: number,
  installationId?: number,
): Promise<ActiveRepositoryMapping | null> {
  let query = admin
    .from("team_repositories")
    .select("github_repo_id,installation_id,full_name")
    .eq("team_id", teamId)
    .eq("github_repo_id", repositoryId)
    .eq("active", true);

  if (installationId !== undefined) {
    query = query.eq("installation_id", installationId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data as ActiveRepositoryMapping;
}
