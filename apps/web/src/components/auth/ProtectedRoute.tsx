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
    // Check the current authentication session.
    supabase.auth.getUser().then(({ data, error }) => {
      setAuthenticated(!error && !!data.user);
      setLoading(false);
    });

    // Keep authentication state updated after login/logout.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setAuthenticated(!!session);
        setLoading(false);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return <div className="p-8">Loading workspace...</div>;
  }

  return authenticated ? <>{children}</> : <Navigate to="/login" replace />;
}