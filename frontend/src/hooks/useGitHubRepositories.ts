
import { useEffect, useState } from "react";

import {
  fetchGitHubProfile,
  fetchGitHubRepositories,
  type GitHubProfile,
  type GitHubRepository,
} from "../lib/github";

// This hook fetches public GitHub data.
// It does not save usernames or use localStorage.
export function useGitHubRepositories(username: string) {
  // Store the GitHub user profile.
  const [profile, setProfile] = useState<GitHubProfile | null>(null);

  // Store the fetched public repositories.
  const [repositories, setRepositories] =
    useState<GitHubRepository[]>([]);

  // Track API loading and error states.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Trigger a new request when the user clicks Refresh.
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch data when the username or refresh key changes.
  useEffect(() => {
    // Remove extra spaces from the username.
    const cleanUsername = username.trim();

    // Clear old data when no username is available.
    if (!cleanUsername) {
      setProfile(null);
      setRepositories([]);
      setError("");
      setLoading(false);
      return;
    }

    // Cancel outdated requests when the username changes.
    const controller = new AbortController();

    async function loadRepositories() {
      // Start loading and clear previous results.
      setLoading(true);
      setError("");
      setProfile(null);
      setRepositories([]);

      try {
        // Fetch the profile and repositories together.
        const [userProfile, userRepositories] =
          await Promise.all([
            fetchGitHubProfile(
              cleanUsername,
              controller.signal
            ),
            fetchGitHubRepositories(
              cleanUsername,
              controller.signal
            ),
          ]);

        // Update state only if the request is still active.
        if (!controller.signal.aborted) {
          setProfile(userProfile);
          setRepositories(userRepositories);
        }
      } catch (err) {
        // Ignore errors caused by cancelled requests.
        if (controller.signal.aborted) {
          return;
        }

        // Show a useful error message.
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load GitHub repositories."
        );
      } finally {
        // Stop loading only for the active request.
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    // Start the API request.
    void loadRepositories();

    // Cancel the request when the hook updates or unmounts.
    return () => {
      controller.abort();
    };
  }, [username, refreshKey]);

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
