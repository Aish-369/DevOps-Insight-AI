
// This file fetches real GitHub Actions workflow runs.

export type PipelineRun = {
  id: number;
  name: string | null;
  display_title: string;
  status: string;
  conclusion: string | null;
  head_branch: string | null;
  event: string;
  html_url: string;
  run_number: number;
  created_at: string;
};

type GitHubRunsResponse = {
  workflow_runs: PipelineRun[];
};

export async function fetchPipelineRuns(
  owner: string,
  repo: string,
  signal?: AbortSignal
): Promise<PipelineRun[]> {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(repo)}/actions/runs?per_page=30`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
    },
    signal,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "Repository or workflow runs not found. Check public access."
      );
    }

    if (response.status === 403 || response.status === 429) {
      throw new Error(
        "GitHub API limit reached or access denied. Try again later."
      );
    }

    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data: GitHubRunsResponse = await response.json();

  return data.workflow_runs ?? [];
}
