import { useEffect, useState } from "react";

import {
  fetchGitHubProfile,
  fetchGitHubRepositories,
  type GitHubProfile,
  type GitHubRepository,
} from "../lib/github";

// Store the result of a GitHub API request.
type GitHubResult = {
  requestKey: string;
  profile: GitHubProfile | null;
  repositories: GitHubRepository[];
  error: string;
};

// This hook fetches public GitHub data.
// It does not save usernames or use localStorage.
export function useGitHubRepositories(username: string) {
  // Track manual refresh requests.
  const [refreshKey, setRefreshKey] = useState(0);

  // Store the latest completed API request.
  const [result, setResult] = useState<GitHubResult | null>(null);

  // Remove extra spaces from the username.
  const cleanUsername = username.trim();

  // Identify each request using username and refresh count.
  const requestKey = `${cleanUsername}:${refreshKey}`;

  // Fetch data when the username or refresh key changes.
  useEffect(() => {
    // Do not make an API request without a username.
    if (!cleanUsername) {
      return;
    }

    // Cancel outdated requests when the username changes.
    const controller = new AbortController();

    async function loadRepositories() {
      try {
        // Fetch the profile and repositories together.
        const [userProfile, userRepositories] = await Promise.all([
          fetchGitHubProfile(cleanUsername, controller.signal),
          fetchGitHubRepositories(cleanUsername, controller.signal),
        ]);

        // Ignore results from cancelled requests.
        if (controller.signal.aborted) {
          return;
        }

        // Save the completed API response.
        setResult({
          requestKey,
          profile: userProfile,
          repositories: userRepositories,
          error: "",
        });
      } catch (err) {
        // Ignore errors caused by cancelled requests.
        if (controller.signal.aborted) {
          return;
        }

        // Save the API error.
        setResult({
          requestKey,
          profile: null,
          repositories: [],
          error:
            err instanceof Error
              ? err.message
              : "Unable to load GitHub repositories.",
        });
      }
    }

    // Start the API request.
    void loadRepositories();

    // Cancel the request when the hook updates or unmounts.
    return () => {
      controller.abort();
    };
  }, [cleanUsername, requestKey]);

  // Use only results belonging to the current request.
  const currentResult =
    result?.requestKey === requestKey ? result : null;

  // Derive loading and data from the current request.
  const loading = Boolean(cleanUsername) && !currentResult;
  const profile = currentResult?.profile ?? null;
  const repositories = currentResult?.repositories ?? [];
  const error = currentResult?.error ?? "";

  // Allow the user to manually reload GitHub data.
  function refresh() {
    setRefreshKey((previous) => previous + 1);
  }

  // Return the data and actions needed by the UI.
  return {
    profile,
    repositories,
    loading,
    error,
    refresh,
  };
}
