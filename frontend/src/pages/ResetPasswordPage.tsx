import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getErrorMessage } from "../lib/errorMessage";
import { supabase } from "../lib/supabase";
import "./AuthLifecycle.css";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    let active = true;
    let recoveryEventSeen = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active || event !== "PASSWORD_RECOVERY" || !session) return;
      recoveryEventSeen = true;
      setRecoveryReady(true);
      setLinkError("");
      setChecking(false);
    });

    void supabase.auth.getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || recoveryEventSeen) return;
        if (sessionError) throw sessionError;
        if (!data.session) {
          setLinkError("This password reset link is invalid, expired, or has already been used. Request a new link.");
        } else {
          setLinkError("Open the password reset link from your latest recovery email to continue.");
        }
      })
      .catch((sessionError: unknown) => {
        if (!active || recoveryEventSeen) return;
        setLinkError(getErrorMessage(sessionError, "Unable to verify this password reset link. Request a new link."));
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setUpdated(false);

    if (password.length < 12) {
      setError("Use at least 12 characters for your new password.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword("");
      setConfirmPassword("");
      setUpdated(true);
    } catch (updateError: unknown) {
      setError(getErrorMessage(updateError, "Unable to update your password. Request a new reset link if this session has expired."));
    } finally {
      setSaving(false);
    }
  }

  if (checking) {
    return (
      <main className="auth-lifecycle-page">
        <section className="auth-lifecycle-card" role="status">Verifying your recovery link…</section>
      </main>
    );
  }

  if (!recoveryReady) {
    return (
      <main className="auth-lifecycle-page">
        <section className="auth-lifecycle-card" aria-labelledby="reset-invalid-title">
          <Link className="auth-lifecycle-brand" to="/login">DevOps Insight AI</Link>
          <p className="auth-lifecycle-eyebrow">ACCOUNT RECOVERY</p>
          <h1 id="reset-invalid-title">Reset link unavailable</h1>
          <p className="auth-lifecycle-error" role="alert">{linkError || "This recovery session is not valid."}</p>
          <Link className="auth-lifecycle-primary-link" to="/forgot-password">Request a new reset link</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-lifecycle-page">
      <section className="auth-lifecycle-card" aria-labelledby="reset-password-title">
        <Link className="auth-lifecycle-brand" to="/login">DevOps Insight AI</Link>
        <p className="auth-lifecycle-eyebrow">SECURE YOUR ACCOUNT</p>
        <h1 id="reset-password-title">Choose a new password</h1>
        <p className="auth-lifecycle-description">
          Use at least 12 characters. Do not reuse a password from another service.
        </p>

        {updated ? (
          <div role="status">
            <p className="auth-lifecycle-success">Your password has been updated.</p>
            <button type="button" onClick={() => navigate("/dashboard", { replace: true })}>
              Continue to your workspace
            </button>
          </div>
        ) : (
          <form className="auth-lifecycle-form" onSubmit={handleSubmit}>
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <label htmlFor="confirm-new-password">Confirm new password</label>
            <input
              id="confirm-new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />

            {error && <p className="auth-lifecycle-error" role="alert">{error}</p>}
            <button type="submit" disabled={saving}>
              {saving ? "Updating password…" : "Update password"}
            </button>
          </form>
        )}
        <p className="auth-lifecycle-footer"><Link to="/login">Back to sign in</Link></p>
      </section>
    </main>
  );
}
