
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage("");

    if (password.length < 8) {
      setMessage("Use at least 8 characters for your password.");
      return;
    }

    setLoading(true);

    try {
      // Create a real Supabase user account.
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (error) {
        setMessage("Signup could not be completed. Please try again.");
        return;
      }

      // Do not claim the email was sent or the account was created
      // without checking the provider's actual response.
      setMessage(
        "Request processed. If confirmation is required, check your email."
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fff5e8] p-5">
      <div className="clay-card w-full max-w-md rounded-[32px] p-8">
        <h1 className="text-3xl font-extrabold">
          Create your workspace
        </h1>
        <p className="mt-2 text-[#68756d]">
          Join DevOps Insight AI
        </p>

        <form onSubmit={handleSignup} className="mt-8 space-y-5">
          <div>
            <label htmlFor="signup-email" className="mb-2 block font-semibold">
              Work email
            </label>
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="clay-input w-full rounded-2xl p-4 outline-none"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label htmlFor="signup-password" className="mb-2 block font-semibold">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="clay-input w-full rounded-2xl p-4 outline-none"
              placeholder="Minimum 8 characters"
            />
          </div>

          {message && <p role="status" className="text-sm">{message}</p>}

          <button
            disabled={loading}
            className="w-full rounded-2xl bg-[#e99d7f] p-4 font-bold disabled:opacity-60"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm">
          Already registered?{" "}
          <Link to="/login" className="font-bold text-[#476c5a]">
            Sign In
          </Link>
        </p>
      </div>
    </main>
  );
}
