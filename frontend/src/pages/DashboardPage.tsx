
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  Activity,
  GitBranch,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Workflow,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

import { supabase } from "../lib/supabase";

import {
  getSavedGitHubUsername,
  useGitHubRepositories,
} from "../hooks/useGitHubRepositories";

import "../styles/DashboardPage.css";

export default function DashboardPage() {
  const navigate = useNavigate();

  const [userName, setUserName] = useState("Developer");
  const [logoutError, setLogoutError] = useState("");

  // Read the username previously saved on the repositories page.
  const [githubUsername] = useState(getSavedGitHubUsername);

  // Fetch real public repository data.
  const {
    repositories,
    loading,
    error,
  } = useGitHubRepositories(githubUsername);

  useEffect(() => {
    // Load the signed-in user's name.
    async function loadUser() {
      const { data, error: userError } =
        await supabase.auth.getUser();

      if (userError || !data.user) {
        return;
      }

      const fullName = data.user.user_metadata?.full_name;
      const emailName = data.user.email?.split("@")[0];

      setUserName(fullName || emailName || "Developer");
    }

    void loadUser();
  }, []);

  // Sign out using Supabase Authentication.
  async function handleLogout() {
    setLogoutError("");

    const { error: signOutError } =
      await supabase.auth.signOut();

    if (signOutError) {
      setLogoutError(signOutError.message);
      return;
    }

    navigate("/login", { replace: true });
  }

  // Repository count comes from the real GitHub API.
  // Other metrics remain unavailable until their APIs exist.
  const stats = [
    {
      label: "Public Repositories",
      value: !githubUsername
        ? "—"
        : loading
          ? "..."
          : error
            ? "—"
            : String(repositories.length),
      icon: GitBranch,
    },
    {
      label: "Pipeline Runs",
      value: "—",
      icon: Workflow,
    },
    {
      label: "Active Alerts",
      value: "—",
      icon: Activity,
    },
    {
      label: "Connected Teams",
      value: "—",
      icon: ShieldCheck,
    },
  ];

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="dashboard-sidebar">
        <h2 className="dashboard-brand">
          DevOps Insight AI
        </h2>

        <nav className="dashboard-nav">
          <Link
            to="/dashboard"
            className="dashboard-nav-item active"
          >
            <LayoutDashboard size={19} />
            <span>Overview</span>
          </Link>

          <Link
            to="/repositories"
            className="dashboard-nav-item"
          >
            <GitBranch size={19} />
            <span>Repositories</span>
          </Link>

          {/* Navigate to the real CI/CD pipelines page */}
<Link to="/pipelines" className="dashboard-nav-item">
  <Workflow size={19} />
  <span>Pipelines</span>
</Link>
        </nav>

        <button
          type="button"
          className="dashboard-logout"
          onClick={handleLogout}
        >
          <LogOut size={19} />
          Sign out
        </button>

        {logoutError && (
          <p role="alert" className="signup-error">
            {logoutError}
          </p>
        )}
      </aside>

      {/* Main dashboard */}
      <main className="dashboard-main">
        <header className="dashboard-header">
          <p className="dashboard-eyebrow">
            Workspace overview
          </p>

          <h1 className="dashboard-title">
            Welcome back, {userName}!
          </h1>

          <p className="dashboard-description">
            Your DevOps monitoring workspace.
          </p>
        </header>

        {/* Statistics cards */}
        <section className="dashboard-stats">
          {stats.map((stat) => {
            const Icon = stat.icon;

            return (
              <article
                className="dashboard-stat-card"
                key={stat.label}
              >
                <div className="dashboard-stat-icon">
                  <Icon size={22} />
                </div>

                <p className="dashboard-stat-label">
                  {stat.label}
                </p>

                <p className="dashboard-stat-value">
                  {stat.value}
                </p>
              </article>
            );
          })}
        </section>

        {/* GitHub repositories overview */}
        <section className="dashboard-panel">
          <div className="dashboard-empty-icon">
            <GitBranch size={26} />
          </div>

          <h2 className="dashboard-panel-title">
            GitHub Repositories
          </h2>

          {githubUsername ? (
            <>
              <p className="dashboard-panel-text">
                Viewing public repositories for{" "}
                <strong>@{githubUsername}</strong>.
              </p>

              {loading ? (
                <p className="dashboard-panel-text">
                  Loading repository data...
                </p>
              ) : error ? (
                <p className="dashboard-panel-text" role="alert">
                  {error}
                </p>
              ) : (
                <p className="dashboard-panel-text">
                  {repositories.length} public repositories
                  loaded from GitHub.
                </p>
              )}
            </>
          ) : (
            <p className="dashboard-panel-text">
              Explore GitHub repositories by entering
              a public GitHub username.
            </p>
          )}

          <Link
            to="/repositories"
            className="dashboard-github-link"
          >
            {githubUsername
              ? "View repositories"
              : "Explore GitHub"}
            <ArrowRight size={17} />
          </Link>
        </section>

        {/* Recent activity */}
        <section className="dashboard-panel">
          <h2 className="dashboard-panel-title">
            Recent activity
          </h2>

          <p className="dashboard-panel-text">
            CI/CD activity monitoring will be available
            after GitHub Actions integration.
          </p>

          <span className="dashboard-coming-soon">
            <RefreshCw size={14} />
            Coming soon
          </span>
        </section>
      </main>
    </div>
  );
}
