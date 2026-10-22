
import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";

export default function ProtectedRoute({
  children,
}: {
  children: ReactNode;
}) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;

    // Validate the current user with the auth service.
    supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      setAuthenticated(!error && !!data.user);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setAuthenticated(false);
      setLoading(false);
    });

    // Listen for login/logout changes.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        if (!session) {
          setAuthenticated(false);
          setLoading(false);
        } else {
          // Session presence is not backend authorization.
          // Revalidate before granting this UI route.
          supabase.auth.getUser().then(({ data, error }) => {
            if (!active) return;
            setAuthenticated(!error && !!data.user);
            setLoading(false);
          }).catch(() => {
            if (!active) return;
            setAuthenticated(false);
            setLoading(false);
          });
        }
      }
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <p className="p-8 text-center">
        Checking your session...
      </p>
    );
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
