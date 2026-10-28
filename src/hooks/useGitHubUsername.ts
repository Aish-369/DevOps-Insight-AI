
import { useCallback, useEffect, useState } from "react";

import { supabase } from "../lib/supabase";

// Manage the GitHub username for the signed-in user.
export function useGitHubUsername() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load the username from the current user's profile.
  const loadUsername = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      // Get the currently signed-in Supabase user.
      const { data: authData, error: authError } =
        await supabase.auth.getUser();

      if (authError) throw authError;

      // Clear the username if nobody is signed in.
      if (!authData.user) {
        setUsername("");
        return;
      }

      // Read only this user's GitHub username.
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("github_username")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) throw profileError;

      setUsername(data?.github_username ?? "");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load the GitHub username."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Load the profile when the hook is first used.
  useEffect(() => {
    void loadUsername();
  }, [loadUsername]);

  // Save the username to the signed-in user's profile.
  const saveUsername = useCallback(async (value: string) => {
    const cleanUsername = value.trim();

    setSaving(true);
    setError("");

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

      setUsername(cleanUsername);
      return true;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save the GitHub username."
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

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
