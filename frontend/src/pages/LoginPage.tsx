
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Eye, EyeOff } from "lucide-react";
import { supabase } from "../lib/supabase";

type FormMode = "login" | "forgot" | "reset";

const RECOVERY_SESSION_KEY = "devops-insight-password-recovery";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [mode, setMode] = useState<FormMode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [recoveryChecking, setRecoveryChecking] = useState(false);

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const recoveryRequested = searchParams.get("mode") === "reset";

  // Only enable password reset after Supabase confirms a recovery event.
  useEffect(() => {
    if (!recoveryRequested) {
      setMode("login");
      setRecoveryChecking(false);
      return;
    }

    setRecoveryChecking(true);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        sessionStorage.setItem(RECOVERY_SESSION_KEY, "true");
        setMode("reset");
        setError("");
        setSuccess("");
        setRecoveryChecking(false);
        return;
      }

      if (
        event === "INITIAL_SESSION" &&
        session &&
        sessionStorage.getItem(RECOVERY_SESSION_KEY) === "true"
      ) {
        setMode("reset");
        setRecoveryChecking(false);
      }

      if (event === "INITIAL_SESSION" && !session) {
        setError(
          "This password reset link is invalid or has expired. Please request a new link.",
        );
        setRecoveryChecking(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [recoveryRequested]);

  function clearMessages() {
    setError("");
    setSuccess("");
  }

  function returnToLogin() {
    clearMessages();
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setMode("login");
    setSearchParams({}, { replace: true });
  }

  // Sign in with the user's Supabase account.
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();

    setLoading(true);

    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (loginError) {
        setError(
          loginError.message === "Invalid login credentials"
            ? "Incorrect email or password. Please check your details and try again."
            : loginError.message,
        );
        return;
      }

      navigate("/dashboard", { replace: true });
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Send a secure password recovery email.
  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      setError("Please enter your email address.");
      return;
    }

    setLoading(true);

    try {
      const redirectTo = `${window.location.origin}/login?mode=reset`;

      const { error: recoveryError } =
        await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo,
        });

      if (recoveryError) {
        setError(recoveryError.message);
        return;
      }

      setSuccess(
        "If an account exists for this email, a password reset link has been sent. Please check your inbox and spam folder.",
      );
    } catch {
      setError("Unable to send the reset email. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Update the password after a verified recovery session.
  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();

    if (sessionStorage.getItem(RECOVERY_SESSION_KEY) !== "true") {
      setError(
        "Your password reset session is not verified. Please request a new reset link.",
      );
      return;
    }

    if (password.length < 8) {
      setError("Your password must contain at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      // End only this browser's session after the password is changed.
      await supabase.auth.signOut({ scope: "local" });

      sessionStorage.removeItem(RECOVERY_SESSION_KEY);
      setPassword("");
      setConfirmPassword("");
      setSearchParams({}, { replace: true });
      setMode("login");
      setSuccess("Your password has been updated successfully. Please sign in.");
    } catch {
      setError(
        "We could not update your password. Please request a new reset link and try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  // Sign in using a GitHub account.
  async function handleGithubLogin() {
    clearMessages();
    setLoading(true);

    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (oauthError) {
        setError(oauthError.message);
        setLoading(false);
      }
    } catch {
      setError("Unable to connect to GitHub. Please try again.");
      setLoading(false);
    }
  }

  const isLogin = mode === "login";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";

  return (
    <main className="login-screen">
      <section className="login-card">
        {/* Left side: existing branding and illustration. */}
        <div className="login-visual">
          <div className="visual-glow visual-glow-one" />
          <div className="visual-glow visual-glow-two" />

          <Link to="/login" className="brand">
            <span className="brand-icon">D</span>
            <span>DevOps Insight</span>
          </Link>

          <div className="visual-content">
            <div className="illustration">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />

              <div className="cloud-shape">
                <div className="cloud-dot dot-one" />
                <div className="cloud-dot dot-two" />
                <div className="cloud-dot dot-three" />
              </div>

              <div className="floating-tile tile-code">
                <span>{"</>"}</span>
              </div>

              <div className="floating-tile tile-check">
                <span>✓</span>
              </div>

              <div className="floating-tile tile-branch">
                <span className="github-label">GH</span>
              </div>

              <div className="base-platform">
                <div className="platform-line" />
                <div className="platform-line short-line" />
                <div className="platform-status">
                  <span />
                  All systems ready
                </div>
              </div>
            </div>

            <div className="visual-caption">
              <h1>Everything in one place.</h1>
              <p>One simple space for your development workflow.</p>
            </div>
          </div>

          <div className="visual-footer">
            <span className="footer-dot" />
            Built for teams that build
          </div>
        </div>

        {/* Right side: login and password recovery forms. */}
        <div className="login-form-panel">
          <div className="mobile-brand">
            <span className="brand-icon">D</span>
            <span>DevOps Insight</span>
          </div>

          {recoveryRequested && recoveryChecking ? (
            <div className="form-heading" aria-live="polite">
              <span className="welcome-label">SECURE RECOVERY</span>
              <h2>Verifying link</h2>
              <p>Please wait while we verify your password reset session.</p>
            </div>
          ) : (
            <>
              <div className="form-heading">
                <span className="welcome-label">
                  {isLogin
                    ? "WELCOME BACK"
                    : isForgot
                      ? "ACCOUNT RECOVERY"
                      : isReset
                        ? "SECURE RECOVERY"
                        : "WELCOME BACK"}
                </span>

                <h2>
                  {isLogin
                    ? "Sign in"
                    : isForgot
                      ? "Forgot password?"
                      : isReset
                        ? "Create new password"
                        : "Sign in"}
                </h2>

                <p>
                  {isLogin
                    ? "Enter your details to continue."
                    : isForgot
                      ? "Enter your registered email address. We'll send you a secure reset link."
                      : isReset
                        ? "Choose a strong new password for your account."
                        : "Enter your details to continue."}
                </p>
              </div>

              {isLogin && (
                <form onSubmit={handleLogin} className="login-form">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    disabled={loading}
                  />

                  <div className="password-label-row">
                    <label htmlFor="password">Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        clearMessages();
                        setMode("forgot");
                      }}
                      disabled={loading}
                      style={{
                        border: 0,
                        padding: 0,
                        background: "none",
                        color: "#718c72",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Forgot password?
                    </button>
                  </div>

                  <div className="password-input-wrap">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      disabled={loading}
                    />

                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      disabled={loading}
                    >
                      {showPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>

                  {error && (
                    <p className="login-error" role="alert">
                      {error}
                    </p>
                  )}

                  {success && (
                    <p
                      role="status"
                      style={{
                        margin: "12px 0 0",
                        color: "#5f7c61",
                        fontSize: "12px",
                      }}
                    >
                      {success}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="sign-in-button"
                    disabled={loading}
                  >
                    {loading ? "Signing in..." : "Sign in"}
                    {!loading && <ArrowRight size={18} />}
                  </button>
                </form>
              )}

              {isForgot && (
                <form
                  onSubmit={handleForgotPassword}
                  className="login-form"
                >
                  <label htmlFor="recovery-email">Email address</label>
                  <input
                    id="recovery-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    required
                    disabled={loading || Boolean(success)}
                  />

                  {error && (
                    <p className="login-error" role="alert">
                      {error}
                    </p>
                  )}

                  {success && (
                    <p
                      role="status"
                      style={{
                        margin: "12px 0",
                        color: "#5f7c61",
                        fontSize: "12px",
                        lineHeight: 1.6,
                      }}
                    >
                      {success}
                    </p>
                  )}

                  {!success && (
                    <button
                      type="submit"
                      className="sign-in-button"
                      disabled={loading}
                    >
                      {loading ? "Sending link..." : "Send reset link"}
                      {!loading && <ArrowRight size={18} />}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={returnToLogin}
                    disabled={loading}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      width: "100%",
                      marginTop: "18px",
                      padding: "8px",
                      border: 0,
                      background: "none",
                      color: "#718c72",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <ArrowLeft size={15} />
                    Back to sign in
                  </button>
                </form>
              )}

              {isReset && (
                <form
                  onSubmit={handleResetPassword}
                  className="login-form"
                >
                  <label htmlFor="new-password">New password</label>
                  <div className="password-input-wrap">
                    <input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      required
                      disabled={loading}
                    />

                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      disabled={loading}
                    >
                      {showPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>

                  <label
                    htmlFor="confirm-password"
                    style={{ marginTop: "18px" }}
                  >
                    Confirm new password
                  </label>

                  <div className="password-input-wrap">
                    <input
                      id="confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter your new password"
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      autoComplete="new-password"
                      minLength={8}
                      required
                      disabled={loading}
                    />

                    <button
                      type="button"
                      className="password-toggle"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      aria-label={
                        showConfirmPassword
                          ? "Hide confirm password"
                          : "Show confirm password"
                      }
                      disabled={loading}
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={18} />
                      ) : (
                        <Eye size={18} />
                      )}
                    </button>
                  </div>

                  {error && (
                    <p className="login-error" role="alert">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="sign-in-button"
                    disabled={loading}
                  >
                    {loading ? "Updating password..." : "Update password"}
                    {!loading && <ArrowRight size={18} />}
                  </button>
                </form>
              )}

              {isLogin && (
                <>
                  <div className="form-divider">
                    <span />
                    <p>or continue with</p>
                    <span />
                  </div>

                  <button
                    type="button"
                    className="github-button"
                    onClick={handleGithubLogin}
                    disabled={loading}
                  >
                    <span className="github-label">GH</span>
                    GitHub
                  </button>

                  <p className="signup-note">
                    New here? <Link to="/signup">Create an account</Link>
                  </p>

                  <p className="privacy-note">
                    Secure sign-in · Your workspace awaits
                  </p>
                </>
              )}

              {(isForgot || isReset) && (
                <p className="signup-note">
                  Remember your password?{" "}
                  <button
                    type="button"
                    onClick={returnToLogin}
                    style={{
                      border: 0,
                      padding: 0,
                      background: "none",
                      color: "#718c72",
                      fontSize: "inherit",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Sign in
                  </button>
                </p>
              )}
            </>
          )}

          {recoveryRequested && error && mode !== "reset" && (
            <button
              type="button"
              onClick={returnToLogin}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                marginTop: "18px",
                padding: "8px",
                border: 0,
                background: "none",
                color: "#718c72",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <ArrowLeft size={15} />
              Back to sign in
            </button>
          )}
        </div>
      </section>
    </main>
  );
}
