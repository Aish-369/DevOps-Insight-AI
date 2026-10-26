
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../styles/DashboardPage.css";
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

import {
  fetchRepositoryCommits,
  type GitHubCommit,
} from "../lib/githubActivity";



export default function DashboardPage() {
  const navigate = useNavigate();

  const [userName, setUserName] = useState("Developer");
  const [logoutError, setLogoutError] = useState("");

  // Read the saved GitHub username.
  const [githubUsername] = useState(getSavedGitHubUsername);

  // Store recent commits from GitHub.
  const [recentCommits, setRecentCommits] =
    useState<GitHubCommit[]>([]);

  // Track the commit-loading state.
  const [activityLoading, setActivityLoading] = useState(false);

  // Store errors from the GitHub activity request.
  const [activityError, setActivityError] = useState("");

  // Load the user's public GitHub repositories.
  const {
    repositories,
    loading,
    error,
  } = useGitHubRepositories(githubUsername);

  // Load the signed-in user's display name.
  useEffect(() => {
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

  // Load commits when the repository data becomes available.
  useEffect(() => {
    // Do not request commits without a username or repository.
    if (!githubUsername || loading || error) {
      setRecentCommits([]);
      setActivityError("");
      setActivityLoading(false);
      return;
    }

    const firstRepository = repositories[0];

    if (!firstRepository) {
      setRecentCommits([]);
      setActivityError("");
      setActivityLoading(false);
      return;
    }

    // Cancel the request if the component changes or unmounts.
    const controller = new AbortController();

    async function loadRecentActivity() {
      setActivityLoading(true);
      setActivityError("");
      setRecentCommits([]);

      try {
        const commits = await fetchRepositoryCommits(
          githubUsername,
          firstRepository.name,
          controller.signal
        );

        if (!controller.signal.aborted) {
          setRecentCommits(commits.slice(0, 5));
        }
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        setActivityError(
          err instanceof Error
            ? err.message
            : "Unable to load GitHub activity."
        );
      } finally {
        if (!controller.signal.aborted) {
          setActivityLoading(false);
        }
      }
    }

    void loadRecentActivity();

    return () => {
      controller.abort();
    };
  }, [githubUsername, repositories, loading, error]);

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

  // Display real data only when it is available.
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

  // Format a GitHub commit date for display.
  function formatCommitDate(date: string | undefined) {
    if (!date) {
      return "Date unavailable";
    }

    const parsedDate = new Date(date);

    if (Number.isNaN(parsedDate.getTime())) {
      return "Date unavailable";
    }

    return parsedDate.toLocaleString();
  }

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

          <Link
            to="/pipelines"
            className="dashboard-nav-item"
          >
            <Workflow size={19} />
            <span>Pipelines</span>
          </Link>

          <Link
            to="/activity"
            className="dashboard-nav-item"
          >
            <Activity size={19} />
            <span>Activity Audit</span>
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

        {/* Recent GitHub commit activity */}
        <section className="dashboard-panel">
          <div className="dashboard-activity-heading">
            <div>
              <h2 className="dashboard-panel-title">
                Recent activity
              </h2>

              <p className="dashboard-panel-text">
                Latest commits from your first listed public repository.
              </p>
            </div>

            <RefreshCw
              size={18}
              className={activityLoading ? "activity-spinning" : ""}
            />
          </div>

          {!githubUsername ? (
            <p className="dashboard-panel-text">
              Open Repositories and enter a GitHub username to view activity.
            </p>
          ) : loading || activityLoading ? (
            <p className="dashboard-panel-text">
              Loading recent GitHub commits...
            </p>
          ) : error ? (
            <p className="dashboard-panel-text" role="alert">
              {error}
            </p>
          ) : activityError ? (
            <p className="dashboard-panel-text" role="alert">
              {activityError}
            </p>
          ) : repositories.length === 0 ? (
            <p className="dashboard-panel-text">
              No public repositories were found for this username.
            </p>
          ) : recentCommits.length === 0 ? (
            <p className="dashboard-panel-text">
              No commits were found in the selected repository.
            </p>
          ) : (
            <div className="dashboard-activity-list">
              {recentCommits.map((commit) => (
                <article
                  className="dashboard-activity-item"
                  key={commit.sha}
                >
                  <div className="dashboard-activity-icon">
                    <GitBranch size={18} />
                  </div>

                  <div className="dashboard-activity-content">
                    <p className="dashboard-activity-message">
                      {commit.commit.message.split("\n")[0]}
                    </p>

                    <p className="dashboard-activity-meta">
                      {commit.commit.author?.name ||
                        commit.author?.login ||
                        "Unknown author"}
                      {" · "}
                      {formatCommitDate(commit.commit.author?.date)}
                    </p>

                    <a
                      className="dashboard-commit-link"
                      href={commit.html_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View commit on GitHub
                      <ArrowRight size={14} />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
