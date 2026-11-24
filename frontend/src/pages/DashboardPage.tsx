import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  GitBranch,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Settings,
  Users,
  Bell,
  Workflow,
} from "lucide-react";

import { supabase } from "../lib/supabase";
import { useGitHubRepositories } from "../hooks/useGitHubRepositories";
import { useGitHubUsername } from "../hooks/useGitHubUsername";
import {
  fetchRepositoryCommits,
  type GitHubCommit,
} from "../lib/githubActivity";

import "../styles/DashboardPage.css";

// Store commit results with the repository request key.
type ActivityResult = {
  requestKey: string;
  commits: GitHubCommit[];
  error: string;
};

export default function DashboardPage() {
  const navigate = useNavigate();

  // Store the signed-in user's display name.
  const [userName, setUserName] = useState("Developer");

  // Store logout errors.
  const [logoutError, setLogoutError] = useState("");
  const [platformStats, setPlatformStats] = useState({ teams: "—", runs: "—", alerts: "—" });

  // Load the GitHub username from the signed-in user's Supabase profile.
  const {
    username: githubUsername,
    loading: usernameLoading,
    error: usernameError,
  } = useGitHubUsername();

  // Load public repositories for the saved GitHub username.
  const {
    repositories,
    loading,
    error,
  } = useGitHubRepositories(
    usernameLoading || usernameError ? "" : githubUsername
  );

  // Store the latest recent activity request result.
  const [activityResult, setActivityResult] =
    useState<ActivityResult | null>(null);

  // Load the signed-in user's display name.
  useEffect(() => {
    let active = true;

    async function loadUser() {
      const { data, error: userError } =
        await supabase.auth.getUser();

      // Stop if the request failed or there is no signed-in user.
      if (userError || !data.user || !active) {
        return;
      }

      // Prefer the full name, then use the email prefix.
      const fullName = data.user.user_metadata?.full_name;
      const emailName = data.user.email?.split("@")[0];

      setUserName(fullName || emailName || "Developer");
    }

    void loadUser();

    // Prevent state updates after the component unmounts.
    return () => {
      active = false;
    };
  }, []);

  // Load team-scoped platform counters; keep them unavailable until the migration is deployed.
  useEffect(() => {
    let active = true;
    async function loadPlatformStats() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) return;

      const { data: teamRows, error: teamError } = await supabase.from("teams").select("id");
      if (!active || teamError || !teamRows) return;
      const teamIds = teamRows.map((team) => team.id);
      if (teamIds.length === 0) {
        setPlatformStats({ teams: "0", runs: "0", alerts: "0" });
        return;
      }

      const [runResult, alertResult] = await Promise.all([
        supabase.from("workflow_runs").select("github_run_id", { count: "exact", head: true }).in("team_id", teamIds),
        supabase.from("alerts_sent").select("id", { count: "exact", head: true }).in("team_id", teamIds).in("status", ["pending", "failed"]),
      ]);
      if (!active) return;
      setPlatformStats({
        teams: String(teamRows.length),
        runs: runResult.error ? "—" : String(runResult.count ?? 0),
        alerts: alertResult.error ? "—" : String(alertResult.count ?? 0),
      });
    }
    void loadPlatformStats().catch(() => {
      if (active) setPlatformStats({ teams: "—", runs: "—", alerts: "—" });
    });
    return () => { active = false; };
  }, []);

  // Get the first available public repository.
  const firstRepository = repositories[0];

  // Identify the current GitHub activity request.
  const firstRepositoryFullName =
    firstRepository?.full_name ?? "";

  const activityRequestKey = JSON.stringify([
    githubUsername,
    firstRepositoryFullName,
  ]);

  // Only display results belonging to the current request.
  const currentActivityResult =
    activityResult?.requestKey === activityRequestKey
      ? activityResult
      : null;

  // Derive recent commits and errors from the current result.
  const recentCommits = currentActivityResult?.commits ?? [];
  const activityError = currentActivityResult?.error ?? "";

  // Combine profile and repository errors.
  const repositoryError = usernameError || error;

  // Show loading while the current activity request has no result.
  const activityLoading =
    !usernameLoading &&
    !usernameError &&
    Boolean(githubUsername) &&
    !loading &&
    !error &&
    Boolean(firstRepositoryFullName) &&
    !currentActivityResult;

  // Load recent commits after the repository data is available.
  useEffect(() => {
    // Wait until the saved username and repositories have loaded.
    if (usernameLoading || loading) return;

    // Do not request commits without a valid username or repository data.
    if (!githubUsername || usernameError || error) return;

    // Show an empty state when no public repositories exist.
    if (!firstRepositoryFullName) return;

    // Read the owner and repository from the full repository name.
    const [owner, repo] = firstRepositoryFullName.split("/");

    if (!owner || !repo) return;

    // Cancel the request if the username or repository changes.
    const controller = new AbortController();

    async function loadRecentActivity() {
      try {
        // Fetch commits from the first listed public repository.
        const commits = await fetchRepositoryCommits(
          owner,
          repo,
          controller.signal
        );

        // Update the page only if the request is still active.
        if (!controller.signal.aborted) {
          setActivityResult({
            requestKey: activityRequestKey,
            commits: commits.slice(0, 5),
            error: "",
          });
        }
      } catch (err) {
        // Ignore errors from requests that were cancelled.
        if (controller.signal.aborted) {
          return;
        }

        setActivityResult({
          requestKey: activityRequestKey,
          commits: [],
          error:
            err instanceof Error
              ? err.message
              : "Unable to load GitHub activity.",
        });
      }
    }

    void loadRecentActivity();

    // Cancel the request when its dependencies change.
    return () => {
      controller.abort();
    };
  }, [
    githubUsername,
    usernameLoading,
    usernameError,
    firstRepositoryFullName,
    loading,
    error,
    activityRequestKey,
  ]);

  // Sign out using Supabase Authentication.
  async function handleLogout() {
    setLogoutError("");

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      navigate("/login", { replace: true });
    } catch (signOutError: unknown) {
      setLogoutError(
        signOutError instanceof Error
          ? signOutError.message
          : "Unable to sign out. Please try again.",
      );
    }
  }

  // Prepare the dashboard statistics.
  const stats = [
    {
      label: "Public Repositories",
      value: usernameLoading
        ? "..."
        : repositoryError || !githubUsername
          ? "—"
          : loading
            ? "..."
            : String(repositories.length),
      icon: GitBranch,
    },
    {
      label: "Pipeline Runs",
      value: platformStats.runs,
      icon: Workflow,
    },
    {
      label: "Active Alerts",
      value: platformStats.alerts,
      icon: Activity,
    },
    {
      label: "Connected Teams",
      value: platformStats.teams,
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

          <Link to="/teams" className="dashboard-nav-item">
            <Users size={19} /><span>Teams</span>
          </Link>
          <Link to="/integrations" className="dashboard-nav-item">
            <GitBranch size={19} /><span>GitHub App</span>
          </Link>
          <Link to="/workflow-runs" className="dashboard-nav-item">
            <Workflow size={19} /><span>Workflow Runs</span>
          </Link>
          <Link to="/settings/alerts" className="dashboard-nav-item">
            <Bell size={19} /><span>Alerts</span>
          </Link>
          <Link
            to="/settings/account"
            className="dashboard-nav-item"
          >
            <Settings size={19} />
            <span>Account settings</span>
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

          {usernameLoading ? (
            <p className="dashboard-panel-text">
              Loading your saved GitHub username...
            </p>
          ) : usernameError ? (
            <p className="dashboard-panel-text" role="alert">
              {usernameError}
            </p>
          ) : !githubUsername ? (
            <p className="dashboard-panel-text">
              Open Repositories and enter a public GitHub username
              to connect it to your profile.
            </p>
          ) : loading ? (
            <p className="dashboard-panel-text">
              Loading repository data for @{githubUsername}...
            </p>
          ) : error ? (
            <p className="dashboard-panel-text" role="alert">
              {error}
            </p>
          ) : (
            <>
              <p className="dashboard-panel-text">
                Viewing public repositories for{" "}
                <strong>@{githubUsername}</strong>.
              </p>

              <p className="dashboard-panel-text">
                {repositories.length} public repositories loaded
                from GitHub.
              </p>
            </>
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
              className={
                activityLoading ? "activity-spinning" : ""
              }
            />
          </div>

          {usernameLoading ? (
            <p className="dashboard-panel-text">
              Loading your GitHub profile...
            </p>
          ) : usernameError ? (
            <p className="dashboard-panel-text" role="alert">
              {usernameError}
            </p>
          ) : !githubUsername ? (
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
