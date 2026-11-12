
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
// Import icons supported by lucide-react.
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function LoginPage() {
  // Store the form values and UI states.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const navigate = useNavigate();

  // Sign in with the user's Supabase account.
  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    navigate("/dashboard");
  }

  // Sign in using a GitHub account.
  async function handleGithubLogin() {
    setError("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: window.location.origin + "/dashboard",
      },
    });

    if (error) setError(error.message);
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        {/* Left side: soft illustration and minimal branding. */}
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
                {/* Display a simple GitHub label without the missing icon. */}
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

        {/* Right side: simple login form. */}
        <div className="login-form-panel">
          <div className="mobile-brand">
            <span className="brand-icon">D</span>
            <span>DevOps Insight</span>
          </div>

          <div className="form-heading">
            <span className="welcome-label">WELCOME BACK</span>
            <h2>Sign in</h2>
            <p>Enter your details to continue.</p>
          </div>

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
            />

            <div className="password-label-row">
              <label htmlFor="password">Password</label>
              <Link to="/signup">Create account</Link>
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
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="sign-in-button" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
              {!loading && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="form-divider">
            <span />
            <p>or continue with</p>
            <span />
          </div>

          <button
            type="button"
            className="github-button"
            onClick={handleGithubLogin}
          >
            {/* Show a simple GitHub label instead of the missing icon. */}
<span className="github-label">GH</span>
            GitHub
          </button>

          <p className="signup-note">
            New here? <Link to="/signup">Create an account</Link>
          </p>

          <p className="privacy-note">
            Secure sign-in · Your workspace awaits
          </p>
        </div>
      </section>
    </main>
  );
}
