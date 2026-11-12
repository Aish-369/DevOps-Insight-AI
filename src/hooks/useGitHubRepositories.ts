
import { useEffect, useState } from "react";

import {
  fetchGitHubProfile,
  fetchGitHubRepositories,
  type GitHubProfile,
  type GitHubRepository,
} from "../lib/github";

// Store the result of one GitHub API request.
type GitHubResult = {
  requestKey: string;
  profile: GitHubProfile | null;
  repositories: GitHubRepository[];
  error: string;
};

// This hook fetches public GitHub data.
export function useGitHubRepositories(username: string) {
  // Remove extra spaces from the username.
  const cleanUsername = username.trim();

  // Track manual refresh requests.
  const [refreshKey, setRefreshKey] = useState(0);

  // Create a unique key for the current request.
  const requestKey = JSON.stringify([cleanUsername, refreshKey]);

  // Store the latest completed API result.
  const [result, setResult] = useState<GitHubResult>({
    requestKey: "",
    profile: null,
    repositories: [],
    error: "",
  });

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

        // Save results only if the request is still active.
        if (!controller.signal.aborted) {
          setResult({
            requestKey,
            profile: userProfile,
            repositories: userRepositories,
            error: "",
          });
        }
      } catch (err) {
        // Ignore errors caused by cancelled requests.
        if (controller.signal.aborted) {
          return;
        }

        // Save the error for the current request.
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
  }, [cleanUsername, refreshKey, requestKey]);

  // Check whether the stored result belongs to the current request.
  const isCurrentResult = result.requestKey === requestKey;

  // Show empty data while the current request is loading.
  const profile = isCurrentResult ? result.profile : null;
  const repositories = isCurrentResult ? result.repositories : [];
  const error = isCurrentResult ? result.error : "";

  // Loading is derived instead of being changed inside the effect.
  const loading = Boolean(cleanUsername) && !isCurrentResult;

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
