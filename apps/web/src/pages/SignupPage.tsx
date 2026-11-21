
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// Import the matching signup CSS file.
import "../styles/SignupPage.css";

export default function SignupPage() {
  const navigate = useNavigate();

  // Store form input values.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Store loading and feedback messages.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create a new user with Supabase Authentication.
  async function handleSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");
    setSuccess("");

    // Validate the password.
    if (password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    // Make sure both passwords match.
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // Save the user's full name.
          data: {
            full_name: name.trim(),
          },
        },
      });

      if (signupError) {
        setError(signupError.message);
        return;
      }

      if (data.session) {
        // Redirect when the user is already authenticated.
        navigate("/dashboard", { replace: true });
      } else {
        // Email verification may be enabled in Supabase.
        setSuccess(
          "Account created! Please check your email for verification."
        );
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="signup-page">
      <section className="signup-card">
        {/* Brand */}
        <div className="signup-brand">
          DevOps Insight AI
        </div>

        {/* Page heading */}
        <h1 className="signup-title">
          Create your account
        </h1>

        <p className="signup-subtitle">
          Join DevOps Insight AI and manage your development
          workflows from one intelligent workspace.
        </p>

        {/* Signup form */}
        <form className="signup-form" onSubmit={handleSignup}>
          <div className="signup-field">
            <label htmlFor="signup-name">Full name</label>

            <input
              id="signup-name"
              className="signup-input"
              type="text"
              placeholder="Enter your full name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>

          <div className="signup-field">
            <label htmlFor="signup-email">Email address</label>

            <input
              id="signup-email"
              className="signup-input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="signup-field">
            <label htmlFor="signup-password">Password</label>

            <input
              id="signup-password"
              className="signup-input"
              type="password"
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <div className="signup-field">
            <label htmlFor="signup-confirm-password">
              Confirm password
            </label>

            <input
              id="signup-confirm-password"
              className="signup-input"
              type="password"
              placeholder="Confirm your password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              required
            />
          </div>

          {/* Display an error when signup fails. */}
          {error && (
            <p className="signup-error" role="alert">
              {error}
            </p>
          )}

          {/* Display the verification message. */}
          {success && (
            <p className="signup-success" role="status">
              {success}
            </p>
          )}

          <button
            className="signup-button"
            type="submit"
            disabled={loading}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>

        {/* Link to the existing login page. */}
        <p className="signup-footer">
          Already have an account?{" "}
          <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
