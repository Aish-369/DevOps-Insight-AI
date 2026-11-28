import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { getErrorMessage } from "../lib/errorMessage";
import { supabase } from "../lib/supabase";
import "./AuthLifecycle.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitted(false);
    setLoading(true);

    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: `${window.location.origin}/reset-password` },
      );
      if (requestError) throw requestError;
      setSubmitted(true);
    } catch (requestError: unknown) {
      setError(getErrorMessage(requestError, "Unable to submit the password reset request. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-lifecycle-page">
      <section className="auth-lifecycle-card" aria-labelledby="forgot-password-title">
        <Link className="auth-lifecycle-brand" to="/login">DevOps Insight AI</Link>
        <p className="auth-lifecycle-eyebrow">ACCOUNT RECOVERY</p>
        <h1 id="forgot-password-title">Forgot your password?</h1>
        <p className="auth-lifecycle-description">
          Enter the email address associated with your account. If an account exists,
          Supabase will process a password reset email.
        </p>

        <form className="auth-lifecycle-form" onSubmit={handleSubmit}>
          <label htmlFor="recovery-email">Email address</label>
          <input
            id="recovery-email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
          />

          {error && <p className="auth-lifecycle-error" role="alert">{error}</p>}
          {submitted && (
            <p className="auth-lifecycle-success" role="status">
              If an account exists for that address, password reset instructions will be sent.
              Check your inbox and spam folder.
            </p>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Submitting…" : "Send reset instructions"}
          </button>
        </form>

        <p className="auth-lifecycle-footer">
          Remember your password? <Link to="/login">Back to sign in</Link>
        </p>
      </section>
    </main>
  );
}
