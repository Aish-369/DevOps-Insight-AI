
/**
 * GitHub API Service
 *
 * This file provides:
 * 1. Public GitHub user profiles
 * 2. Public GitHub repositories
 * 3. GitHub username extraction
 */

// Base URL for GitHub REST API.
const GITHUB_API_URL = "https://api.github.com";

// Define the repository data used by our frontend.
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

// Define the GitHub user profile data.
export interface GitHubProfile {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  public_repos: number;
}

/**
 * Convert GitHub HTTP errors into readable messages.
 */
async function getErrorMessage(
  response: Response
): Promise<string> {
  // Handle a user or repository that does not exist.
  if (response.status === 404) {
    return "GitHub user not found. Check the username.";
  }

  // Handle API rate limits.
  if (response.status === 403 || response.status === 429) {
    return "GitHub API limit reached. Please try again later.";
  }

  // Handle other HTTP errors.
  return `GitHub request failed (${response.status}).`;
}

/**
 * Fetch a public GitHub user profile.
 *
 * Example:
 * fetchGitHubProfile("Aish-369")
 */
export async function fetchGitHubProfile(
  username: string,
  signal?: AbortSignal
): Promise<GitHubProfile> {
  // Remove unnecessary spaces.
  const cleanUsername = username.trim();

  // Validate the input before making an API request.
  if (!cleanUsername) {
    throw new Error("GitHub username is required.");
  }

  // Send a GET request to GitHub.
  const response = await fetch(
    `${GITHUB_API_URL}/users/${encodeURIComponent(cleanUsername)}`,
    {
      // Cancel the request if React no longer needs it.
      signal,

      // Request the GitHub JSON response format.
      headers: {
        Accept: "application/vnd.github+json",
      },
    }
  );

  // Check whether the API request succeeded.
  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  // Convert the JSON response into a profile object.
  const profile = (await response.json()) as GitHubProfile;

  // Return the profile data.
  return profile;
}

/**
 * Fetch public repositories owned by a GitHub user.
 *
 * GitHub returns a maximum of 100 repositories per page.
 * We use pagination to fetch all available public repositories.
 */
export async function fetchGitHubRepositories(
  username: string,
  signal?: AbortSignal
): Promise<GitHubRepository[]> {
  // Remove extra spaces from the username.
  const cleanUsername = username.trim();

  // Reject empty usernames.
  if (!cleanUsername) {
    throw new Error("GitHub username is required.");
  }

  // Store repositories from all pages.
  const repositories: GitHubRepository[] = [];

  // Start from the first page.
  let page = 1;

  while (true) {
    // Create the API URL.
    const url = new URL(
      `${GITHUB_API_URL}/users/${encodeURIComponent(cleanUsername)}/repos`
    );

    // Configure GitHub API pagination.
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    // Show recently updated repositories first.
    url.searchParams.set("sort", "updated");
    url.searchParams.set("direction", "desc");

    // Fetch repositories owned by the user.
    url.searchParams.set("type", "owner");

    // Send the request to GitHub.
    const response = await fetch(url.toString(), {
      signal,
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    // Stop if GitHub returns an error.
    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    // Convert JSON into an array of repositories.
    const currentPage =
      (await response.json()) as GitHubRepository[];

    // Add this page's repositories to the result.
    repositories.push(...currentPage);

    // A short page means there are no more results.
    if (currentPage.length < 100) {
      break;
    }

    // Request the next page.
    page++;
  }

  // Return all fetched repositories.
  return repositories;
}

/**
 * Extract a GitHub username from different input formats.
 *
 * Examples:
 * Aish-369
 * @Aish-369
 * https://github.com/Aish-369
 * github.com/Aish-369
 * Aish-369/DevOps-Insight-AI
 */
export function extractGitHubUsername(
  input: string
): string {
  // Remove unnecessary spaces.
  const value = input.trim();

  // Return empty text if nothing was entered.
  if (!value) {
    return "";
  }

  // Handle full GitHub URLs.
  if (
    value.startsWith("https://github.com/") ||
    value.startsWith("http://github.com/")
  ) {
    try {
      // Parse the URL.
      const url = new URL(value);

      // Get the username from the first path segment.
      return url.pathname.split("/").filter(Boolean)[0] || "";
    } catch {
      // Handle an invalid URL.
      return "";
    }
  }

  // Handle GitHub URLs without https://.
  if (value.startsWith("github.com/")) {
    return value.split("/")[1] || "";
  }

  // Handle username/repository format.
  if (value.includes("/")) {
    return value.split("/")[0];
  }

  // Handle plain usernames and @usernames.
  return value.replace(/^@/, "");
}
