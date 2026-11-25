import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSafeInternalPath } from "../lib/getSafeInternalPath";
import { supabase } from "../lib/supabase";
import "./AuthLifecycle.css";

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  const nextPath = getSafeInternalPath(searchParams.get("next"), window.location.origin);

  useEffect(() => {
    let active = true;

    async function completeAuthentication() {
      const providerError = searchParams.get("error");
      if (providerError) {
        throw new Error(providerError === "access_denied"
          ? "Sign-in was cancelled. You can try again."
          : "Authentication could not be completed. Please try again.");
      }

      // With PKCE enabled, supabase-js detects the callback code and exchanges it
      // during initialization/getSession. getUser then verifies the session with Auth.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        throw new Error("The authentication link is invalid, expired, or already used.");
      }

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Your session could not be verified. Please sign in again.");

      if (active) navigate(nextPath, { replace: true });
    }

    void completeAuthentication().catch(() => {
      if (!active) return;
      setError("We could not complete sign-in. The link may have expired or been used already. Please sign in again.");
    });

    return () => {
      active = false;
    };
  }, [navigate, nextPath, searchParams]);

  return (
    <main className="auth-lifecycle-page">
      <section className="auth-lifecycle-card" aria-live="polite">
        <Link className="auth-lifecycle-brand" to="/login">DevOps Insight AI</Link>
        {error ? (
          <>
            <h1>Sign-in could not be completed</h1>
            <p className="auth-lifecycle-error" role="alert">{error}</p>
            <Link className="auth-lifecycle-primary-link" to="/login">Return to sign in</Link>
          </>
        ) : (
          <>
            <h1>Completing sign-in…</h1>
            <p className="auth-lifecycle-description">Verifying your account and preparing your workspace.</p>
          </>
        )}
      </section>
    </main>
  );
}
