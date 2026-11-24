import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { getErrorMessage } from "../../lib/errorMessage";
import { isAuthSessionMissingError } from "../../lib/isAuthSessionMissingError";
import { supabase } from "../../lib/supabase";

type ProtectedRouteProps = { children: ReactNode };

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    let authEventVersion = 0;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // A missing session at initialization is an expected signed-out state,
      // not a network/session-verification failure.
      if (event === "INITIAL_SESSION") {
        if (!session) {
          authEventVersion += 1;
          if (!active) return;
          setAuthenticated(false);
          setAuthError("");
          setLoading(false);
        }
        return;
      }

      authEventVersion += 1;
      if (!active) return;
      setAuthenticated(Boolean(session));
      setAuthError("");
      setLoading(false);
    });

    const requestVersion = authEventVersion;

    void supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (!active || authEventVersion !== requestVersion) return;
        if (error) throw error;
        setAuthenticated(Boolean(data.user));
      })
      .catch((error: unknown) => {
        if (!active || authEventVersion !== requestVersion) return;

        if (isAuthSessionMissingError(error)) {
          setAuthenticated(false);
          setAuthError("");
          return;
        }

        setAuthenticated(false);
        setAuthError(
          getErrorMessage(
            error,
            "Unable to verify your session. Check your connection and try again.",
          ),
        );
      })
      .finally(() => {
        if (active && authEventVersion === requestVersion) setLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [retryCount]);

  if (loading) {
    return <div className="p-8" role="status" aria-live="polite">Checking your session…</div>;
  }

  if (authError) {
    return (
      <main className="p-8">
        <div role="alert" className="mx-auto max-w-xl rounded-xl border border-red-200 bg-red-50 p-6 text-red-900">
          <h1 className="font-semibold">We couldn’t verify your session</h1>
          <p className="mt-2 text-sm">{authError}</p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-red-900 px-4 py-2 text-white"
            onClick={() => {
              setLoading(true);
              setAuthError("");
              setRetryCount((count) => count + 1);
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return authenticated ? <>{children}</> : <Navigate to="/login" replace />;
}
