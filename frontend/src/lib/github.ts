import { cachedFetchJson } from "./apiCache";
const GITHUB_API_URL = "https://api.github.com";

// Define the repository data we use in the UI.
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  visibility: string;
  updated_at: string;
  fork: boolean;
}

// Define a simple GitHub profile.
export interface GitHubProfile {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  public_repos: number;
}

// Read the GitHub error response safely.
async function getErrorMessage(response: Response): Promise<string> {
  if (response.status === 404) {
    return "GitHub user not found. Check the username.";
  }

  if (response.status === 403 || response.status === 429) {
    return "GitHub API limit reached. Please try again later.";
  }

  return `GitHub request failed (${response.status}).`;
}

// Fetch a public GitHub user profile.
export async function fetchGitHubProfile(
  username: string,
  signal?: AbortSignal
): Promise<GitHubProfile> {
  const response = await fetch(
    `${GITHUB_API_URL}/users/${encodeURIComponent(username)}`,
    {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return (await response.json()) as GitHubProfile;
}

// Fetch public repositories using GitHub pagination.
// GitHub returns a maximum of 100 repositories per page.
export async function fetchGitHubRepositories(
  username: string,
  signal?: AbortSignal
): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  let page = 1;

  while (true) {
    const url = new URL(
      `${GITHUB_API_URL}/users/${encodeURIComponent(username)}/repos`
    );

    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");
    url.searchParams.set("type", "owner");

    const response = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    const currentPage =
      (await response.json()) as GitHubRepository[];

    repositories.push(...currentPage);

    // A short page means there are no more repositories.
    if (currentPage.length < 100) {
      break;
    }

    page++;
  }

  return repositories;
}
// Extract the GitHub username from different input formats.
export function extractGitHubUsername(input: string): string {
  const value = input.trim();

  if (!value) {
    return "";
  }

  // Handle full GitHub URLs.
  if (
    value.startsWith("https://github.com/") ||
    value.startsWith("http://github.com/")
  ) {
    try {
      const url = new URL(value);
      return url.pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      return "";
    }
  }

  // Handle github.com/username/repository.
  if (value.startsWith("github.com/")) {
    return value.split("/")[1] || "";
  }

  // Handle username/repository.
  if (value.includes("/")) {
    return value.split("/")[0];
  }

  // Handle a plain username.
  return value.replace(/^@/, "");
}