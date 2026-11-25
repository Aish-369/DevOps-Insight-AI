import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getErrorMessage } from "../lib/errorMessage";
import { supabase } from "../lib/supabase";
import "./AuthLifecycle.css";

export default function AccountSettingsPage() {
  const [email, setEmail] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [pageError, setPageError] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    let active = true;
    void supabase.auth.getUser()
      .then(({ data, error }) => {
        if (error) throw error;
        if (!data.user) throw new Error("Your session has expired. Sign in again.");
        if (active) {
          setEmail(data.user.email ?? "");
          setNewEmail(data.user.email ?? "");
        }
      })
      .catch((error: unknown) => {
        if (active) setPageError(getErrorMessage(error, "Unable to load your account."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function handleEmailUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError("");
    setEmailMessage("");

    const candidate = newEmail.trim();
    if (!candidate || candidate.length > 254 || !/^[^s@]+@[^s@]+.[^s@]+$/.test(candidate)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    if (candidate.toLowerCase() === email.toLowerCase()) {
      setEmailError("Enter a different email address.");
      return;
    }

    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: candidate });
      if (error) throw error;
      setEmailMessage("Your email change request was accepted. Complete any confirmation steps requested by Supabase before using the new address.");
    } catch (error: unknown) {
      setEmailError(getErrorMessage(error, "Unable to request an email change. Please try again."));
    } finally {
      setSavingEmail(false);
    }
  }

  async function handlePasswordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError("");
    setPasswordMessage("");

    if (newPassword.length < 12) {
      setPasswordError("Use at least 12 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Your password has been updated.");
    } catch (error: unknown) {
      setPasswordError(getErrorMessage(error, "Unable to update your password. You may need to sign in again."));
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <main className="auth-lifecycle-page auth-settings-page">
      <section className="auth-lifecycle-card auth-settings-card">
        <Link className="auth-lifecycle-brand" to="/dashboard">DevOps Insight AI</Link>
        <p className="auth-lifecycle-eyebrow">ACCOUNT</p>
        <h1>Account settings</h1>
        <p className="auth-lifecycle-description">Manage the sign-in details for your account.</p>

        {loading ? (
          <p role="status">Loading account details…</p>
        ) : pageError ? (
          <p className="auth-lifecycle-error" role="alert">{pageError}</p>
        ) : (
          <>
            <form className="auth-lifecycle-form" onSubmit={handleEmailUpdate}>
              <h2>Email address</h2>
              <label htmlFor="current-email">Current email</label>
              <input id="current-email" type="email" value={email} readOnly disabled />
              <label htmlFor="new-email">New email address</label>
              <input
                id="new-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
              />
              {emailError && <p className="auth-lifecycle-error" role="alert">{emailError}</p>}
              {emailMessage && <p className="auth-lifecycle-success" role="status">{emailMessage}</p>}
              <button type="submit" disabled={savingEmail}>
                {savingEmail ? "Submitting…" : "Request email change"}
              </button>
            </form>

            <form className="auth-lifecycle-form auth-settings-password-form" onSubmit={handlePasswordUpdate}>
              <h2>Change password</h2>
              <label htmlFor="settings-new-password">New password</label>
              <input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <label htmlFor="settings-confirm-password">Confirm new password</label>
              <input
                id="settings-confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
              {passwordError && <p className="auth-lifecycle-error" role="alert">{passwordError}</p>}
              {passwordMessage && <p className="auth-lifecycle-success" role="status">{passwordMessage}</p>}
              <button type="submit" disabled={savingPassword}>
                {savingPassword ? "Updating…" : "Update password"}
              </button>
            </form>
          </>
        )}

        <p className="auth-lifecycle-footer"><Link to="/dashboard">Back to workspace</Link></p>
      </section>
    </main>
  );
}
