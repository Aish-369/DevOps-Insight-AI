
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  Activity,
  GitBranch,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { supabase } from "../lib/supabase";

// Import the matching dashboard CSS file.
import "../styles/DashboardPage.css";

export default function DashboardPage() {
  const navigate = useNavigate();

  // Store the signed-in user's name.
  const [userName, setUserName] = useState("Developer");
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    // Load the current user's profile from Supabase.
    async function loadUser() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        return;
      }

      const fullName = data.user.user_metadata?.full_name;
      const emailName = data.user.email?.split("@")[0];

      setUserName(fullName || emailName || "Developer");
    }

    void loadUser();
  }, []);

  // Sign out the user and return to the login page.
  async function handleLogout() {
    setLogoutError("");

    const { error } = await supabase.auth.signOut();

    if (error) {
      setLogoutError(error.message);
      return;
    }

    navigate("/login", { replace: true });
  }

  // Show empty values until real GitHub data is connected.
  const stats = [
    {
      label: "Repositories",
      value: "0",
      icon: GitBranch,
    },
    {
      label: "Pipeline Runs",
      value: "0",
      icon: Workflow,
    },
    {
      label: "Active Alerts",
      value: "0",
      icon: Activity,
    },
    {
      label: "Connected Teams",
      value: "0",
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

        {/* Sidebar navigation */}
        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <div className="dashboard-nav-item active">
            <LayoutDashboard size={19} />
            <span>Overview</span>
          </div>

          <div className="dashboard-nav-item">
            <GitBranch size={19} />
            <span>Repositories</span>
          </div>

          <div className="dashboard-nav-item">
            <Workflow size={19} />
            <span>Pipelines</span>
          </div>
        </nav>

        {/* Logout */}
        <button
          type="button"
          className="dashboard-logout"
          onClick={handleLogout}
        >
          <LogOut size={19} />
          <span>Sign out</span>
        </button>

        {logoutError && (
          <p role="alert" className="signup-error">
            {logoutError}
          </p>
        )}
      </aside>

      {/* Main dashboard */}
      <main className="dashboard-main">
        {/* Welcome section */}
        <header className="dashboard-header">
          <p className="dashboard-eyebrow">
            Workspace overview
          </p>

          <h1 className="dashboard-title">
            Welcome back, {userName}!
          </h1>

          <p className="dashboard-description">
            Monitor repositories, CI/CD pipelines and
            development activity from one workspace.
          </p>
        </header>

        {/* Statistics */}
        <section
          className="dashboard-stats"
          aria-label="Workspace statistics"
        >
          {stats.map((stat) => {
            const Icon = stat.icon;

            return (
              <article
                key={stat.label}
                className="dashboard-stat-card"
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

        {/* Repository section */}
        <section className="dashboard-panel">
          <div className="dashboard-empty-icon">
            <GitBranch size={26} />
          </div>

          <h2 className="dashboard-panel-title">
            Your repositories
          </h2>

          <p className="dashboard-panel-text">
            No repositories connected yet. Once GitHub
            integration is ready, you will be able to
            monitor repository activity and CI/CD pipeline
            failures from this dashboard.
          </p>

          <span className="dashboard-coming-soon">
            GitHub integration coming soon
          </span>
        </section>

        {/* Recent activity section */}
        <section className="dashboard-panel">
          <h2 className="dashboard-panel-title">
            Recent activity
          </h2>

          <p className="dashboard-panel-text">
            No recent activity yet. Pipeline events and
            repository updates will appear here after
            you connect your GitHub account.
          </p>
        </section>
      </main>
    </div>
  );
}
