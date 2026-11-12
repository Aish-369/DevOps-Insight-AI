
const GITHUB_API_URL = "https://api.github.com";

// Information about the person who created the commit.
export interface GitHubCommitAuthor {
  name: string;
  email: string;
  date: string;
}

// Information stored inside a Git commit.
export interface GitHubCommitDetails {
  message: string;
  author: GitHubCommitAuthor | null;
}

// Information about the GitHub account linked to a commit.
export interface GitHubCommitUser {
  login: string;
  avatar_url: string;
  html_url: string;
}

// Information returned by GitHub for each commit.
export interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: GitHubCommitDetails;
  author: GitHubCommitUser | null;
}

// Information about one file changed in a commit.
export interface GitHubChangedFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  changes: number;
  previous_filename?: string;
  patch?: string;
  blob_url?: string;
}

// Complete details returned for a single commit.
export interface GitHubCommitDetail extends GitHubCommit {
  stats: {
    total: number;
    additions: number;
    deletions: number;
  };
  files: GitHubChangedFile[];
}

// Convert common GitHub API errors into readable messages.
async function getGitHubErrorMessage(
  response: Response
): Promise<string> {
  if (response.status === 404) {
    return "Repository or commit not found, or not publicly accessible.";
  }

  if (response.status === 403 || response.status === 429) {
    return "GitHub API limit reached. Try again later.";
  }

  return `GitHub request failed: ${response.status}`;
}

// Load recent commits from a public GitHub repository.
export async function fetchRepositoryCommits(
  owner: string,
  repo: string,
  signal?: AbortSignal
): Promise<GitHubCommit[]> {
  // Reject missing repository information.
  if (!owner.trim() || !repo.trim()) {
    throw new Error("GitHub owner and repository are required.");
  }

  // Encode values so they can be safely used in a URL.
  const safeOwner = encodeURIComponent(owner.trim());
  const safeRepo = encodeURIComponent(repo.trim());

  // Fetch the latest 30 commits from the default branch.
  const url =
    `${GITHUB_API_URL}/repos/${safeOwner}/${safeRepo}/commits?per_page=30`;

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // Return a helpful error if the API request fails.
  if (!response.ok) {
    if (response.status === 409) {
      // GitHub can return 409 when a repository has no commits.
      return [];
    }

    throw new Error(await getGitHubErrorMessage(response));
  }

  // Convert the JSON response into our TypeScript structure.
  const commits = (await response.json()) as GitHubCommit[];

  return commits;
}

// Load full details and changed files for one commit.
export async function fetchCommitDetails(
  owner: string,
  repo: string,
  sha: string,
  signal?: AbortSignal
): Promise<GitHubCommitDetail> {
  // Validate the required values.
  if (!owner.trim() || !repo.trim() || !sha.trim()) {
    throw new Error("Owner, repository, and commit SHA are required.");
  }

  // Encode values before placing them in the API URL.
  const safeOwner = encodeURIComponent(owner.trim());
  const safeRepo = encodeURIComponent(repo.trim());
  const safeSha = encodeURIComponent(sha.trim());

  // Request one commit, including its changed files and statistics.
  const url =
    `${GITHUB_API_URL}/repos/${safeOwner}/${safeRepo}/commits/${safeSha}`;

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // Handle failed requests.
  if (!response.ok) {
    throw new Error(await getGitHubErrorMessage(response));
  }

  // Convert the JSON response into commit detail data.
  const details =
    (await response.json()) as GitHubCommitDetail;

  return details;
}
