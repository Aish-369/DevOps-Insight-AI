
import { useCallback, useEffect, useState } from "react";

import { supabase } from "../lib/supabase";

// Store the result of a username request.
type UsernameResult = {
  requestId: number;
  username: string;
  error: string;
};

// Manage the GitHub username for the signed-in user.
export function useGitHubUsername() {
  const [saving, setSaving] = useState(false);

  // Track requests so the username can be reloaded.
  const [requestId, setRequestId] = useState(0);

  // Store the latest completed request.
  const [result, setResult] = useState<UsernameResult>({
    requestId: -1,
    username: "",
    error: "",
  });

  // Load the username when the request ID changes.
  useEffect(() => {
    let active = true;

    async function loadUsername() {
      try {
        // Verify the currently signed-in Supabase user.
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (authError) throw authError;

        // Clear the username if nobody is signed in.
        if (!authData.user) {
          if (active) {
            setResult({
              requestId,
              username: "",
              error: "",
            });
          }
          return;
        }

        // Read only this user's GitHub username.
        const { data, error: profileError } = await supabase
          .from("profiles")
          .select("github_username")
          .eq("id", authData.user.id)
          .maybeSingle();

        if (profileError) throw profileError;

        // Save the result only if this request is still active.
        if (active) {
          setResult({
            requestId,
            username: data?.github_username ?? "",
            error: "",
          });
        }
      } catch (err) {
        // Store errors only for the active request.
        if (active) {
          setResult({
            requestId,
            username: "",
            error:
              err instanceof Error
                ? err.message
                : "Unable to load the GitHub username.",
          });
        }
      }
    }

    // Start the asynchronous profile request.
    void loadUsername();

    // Ignore outdated requests when the effect is cleaned up.
    return () => {
      active = false;
    };
  }, [requestId]);

  // Check whether the current request has completed.
  const isCurrentResult = result.requestId === requestId;

  // Derive the loading state from the request result.
  const loading = !isCurrentResult;

  // Show only the result belonging to the current request.
  const username = isCurrentResult ? result.username : "";
  const error = isCurrentResult ? result.error : "";

  // Reload the username from Supabase.
  const loadUsername = useCallback(() => {
    setRequestId((previous) => previous + 1);
  }, []);

  // Save the username to the signed-in user's profile.
  const saveUsername = useCallback(async (value: string) => {
    const cleanUsername = value.trim();

    setSaving(true);

    try {
      // Verify the currently signed-in user.
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error("Please sign in before saving a username.");
      }

      // Update only the current user's profile row.
      const { data, error: updateError } = await supabase
        .from("profiles")
        .update({ github_username: cleanUsername || null })
        .eq("id", authData.user.id)
        .select("id");

      if (updateError) throw updateError;

      // Check whether a profile row was updated.
      if (!data || data.length === 0) {
        throw new Error("Profile not found or update not permitted.");
      }

      // Reload the saved username from the database.
      loadUsername();

      return true;
    } catch (err) {
      // Store save errors for the user interface.
      setResult({
        requestId,
        username,
        error:
          err instanceof Error
            ? err.message
            : "Unable to save the GitHub username.",
      });

      return false;
    } finally {
      setSaving(false);
    }
  }, [loadUsername, requestId, username]);

  // Return the profile state and actions to the page.
  return {
    username,
    loading,
    saving,
    error,
    saveUsername,
    reloadUsername: loadUsername,
  };
}
