import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./PlatformPages.css";

export default function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const loginUrl = useMemo(() => {
    const next = "/accept-invitation?token=" + encodeURIComponent(token);
    return "/login?next=" + encodeURIComponent(next);
  }, [token]);

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data, error: authError }) => {
      if (!active) return;
      if (!authError && data.user) {
        setSignedIn(true);
        setEmail(data.user.email ?? "");
      }
    }).finally(() => {
      if (active) setChecking(false);
    });
    return () => { active = false; };
  }, []);

  async function acceptInvitation() {
    setError("");
    if (!/^[0-9a-f]{64}$/i.test(token)) {
      setError("This invitation link is invalid. Ask the team administrator for a new invitation.");
      return;
    }

    setAccepting(true);
    try {
      const { data, error: acceptError } = await supabase.functions.invoke("accept-team-invitation", {
        body: { token },
      });
      if (acceptError) throw acceptError;
      if (!data?.ok || !data.team_id) throw new Error("The invitation could not be accepted.");
      setSuccess(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to accept this invitation.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <main className="platform-page">
      <section className="platform-card">
        <p className="platform-eyebrow">DEVOPS INSIGHT AI / TEAM INVITATION</p>
        <h1>Join a workspace</h1>
        {checking ? (
          <p role="status">Checking your sign-in session…</p>
        ) : success ? (
          <>
            <p className="platform-success" role="status">Invitation accepted. You are now a member of this workspace.</p>
            <button type="button" onClick={() => navigate("/teams", { replace: true })}>Open workspaces</button>
          </>
        ) : !token || !/^[0-9a-f]{64}$/i.test(token) ? (
          <>
            <p className="platform-error" role="alert">This invitation link is invalid or incomplete.</p>
            <Link to="/login">Return to sign in</Link>
          </>
        ) : !signedIn ? (
          <>
            <p>Sign in with the email address that received this invitation. The invitation is tied to that address.</p>
            <Link className="platform-primary-link" to={loginUrl}>Sign in to accept invitation</Link>
            <p className="platform-muted">Do not forward this invitation link. It can be used once and expires after seven days.</p>
          </>
        ) : (
          <>
            <p>Signed in as <strong>{email || "your account"}</strong>.</p>
            <p className="platform-muted">Only the verified email address that received the invitation can accept it.</p>
            {error && <p className="platform-error" role="alert">{error}</p>}
            <button type="button" onClick={() => void acceptInvitation()} disabled={accepting}>
              {accepting ? "Accepting…" : "Accept invitation"}
            </button>
            <p className="platform-muted"><Link to="/teams">Cancel and return to workspaces</Link></p>
          </>
        )}
      </section>
    </main>
  );
}
