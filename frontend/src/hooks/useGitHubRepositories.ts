
import { useEffect, useState } from "react";

import {
  fetchGitHubProfile,
  fetchGitHubRepositories,
  type GitHubProfile,
  type GitHubRepository,
} from "../lib/github";

export const GITHUB_USERNAME_KEY =
  "devops-insight-github-username";

// Get the previously selected GitHub username.
export function getSavedGitHubUsername(): string {
  try {
    return localStorage.getItem(GITHUB_USERNAME_KEY) || "";
  } catch {
    return "";
  }
}

// Store a public GitHub username in the browser.
export function saveGitHubUsername(username: string): void {
  try {
    localStorage.setItem(GITHUB_USERNAME_KEY, username);
  } catch {
    // Continue without persistence if storage is unavailable.
  }
}

export function useGitHubRepositories(username: string) {
  const [profile, setProfile] = useState<GitHubProfile | null>(null);

  const [repositories, setRepositories] =
    useState<GitHubRepository[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Reload data when the username or refresh key changes.
  useEffect(() => {
    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setProfile(null);
      setRepositories([]);
      setError("");
      setLoading(false);
      return;
    }

    // Abort old requests when the username changes.
    const controller = new AbortController();

    async function loadRepositories() {
      setLoading(true);
      setError("");
      setProfile(null);
      setRepositories([]);

      try {
        // Load the profile and repositories together.
        const [userProfile, userRepositories] = await Promise.all([
          fetchGitHubProfile(cleanUsername, controller.signal),
          fetchGitHubRepositories(cleanUsername, controller.signal),
        ]);

        if (!controller.signal.aborted) {
          setProfile(userProfile);
          setRepositories(userRepositories);
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load GitHub repositories."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadRepositories();

    return () => {
      controller.abort();
    };
  }, [username, refreshKey]);

  // Allow the user to manually reload GitHub data.
  function refresh() {
    setRefreshKey((previous) => previous + 1);
  }

  return {
    profile,
    repositories,
    loading,
    error,
    refresh,
  };
}
