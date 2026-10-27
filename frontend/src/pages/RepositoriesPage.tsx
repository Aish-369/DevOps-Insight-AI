
import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { Link } from "react-router-dom";

import {
  ArrowLeft,
  Search,
  RefreshCw,
  GitBranch,
  AlertCircle,
} from "lucide-react";

import RepositoryCard from "../components/github/RepositoryCard";

// Fetch public GitHub profile and repository data.
import { useGitHubRepositories } from "../hooks/useGitHubRepositories";

// Read and save the username in the signed-in user's Supabase profile.
import { useGitHubUsername } from "../hooks/useGitHubUsername";

// Import the page's CSS styles.
import "../styles/RepositoriesPage.css";

export default function RepositoriesPage() {
  // Store the username entered in the input field.
  const [inputUsername, setInputUsername] = useState("");

  // Store search and language filter values.
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("all");

  // Load the username belonging to the signed-in user.
  const {
    username,
    loading: profileLoading,
    saving,
    error: profileError,
    saveUsername,
  } = useGitHubUsername();

  // Do not fetch GitHub data before the profile loads.
  const activeUsername = profileLoading ? "" : username;

  // Fetch public repositories for the saved username.
  const {
    profile,
    repositories,
    loading,
    error,
    refresh,
  } = useGitHubRepositories(activeUsername);

  // Show the saved username after the profile finishes loading.
  useEffect(() => {
    if (!profileLoading) {
      setInputUsername(username);
    }
  }, [profileLoading, username]);

  // Save the entered username to the current user's profile.
  async function handleConnect(
    event: FormEvent<HTMLFormElement>
  ) {
    // Prevent the browser from reloading the page.
    event.preventDefault();

    // Remove extra spaces from the username.
    const cleanUsername = inputUsername.trim();

    // Stop if the username is empty.
    if (!cleanUsername || profileLoading || saving) {
      return;
    }

    // Save the username to Supabase.
    const saved = await saveUsername(cleanUsername);

    // Stop if the database update fails.
    if (!saved) {
      return;
    }

    // Reset search and language filters.
    setSearch("");
    setLanguage("all");

    // Refresh when the saved username has not changed.
    if (cleanUsername === username) {
      refresh();
    }
  }

  // Get unique programming languages from repositories.
  const languages = useMemo(() => {
    const values = repositories
      .map((repository) => repository.language)
      .filter(
        (value): value is string => Boolean(value)
      );

    return [...new Set(values)].sort();
  }, [repositories]);

  // Filter repositories by name, description, and language.
  const filteredRepositories = useMemo(() => {
    return repositories.filter((repository) => {
      const query = search.toLowerCase().trim();

      // Match repository name or description.
      const matchesSearch =
        repository.name.toLowerCase().includes(query) ||
        (repository.description || "")
          .toLowerCase()
          .includes(query);

      // Match the selected programming language.
      const matchesLanguage =
        language === "all" ||
        repository.language === language;

      return matchesSearch && matchesLanguage;
    });
  }, [repositories, search, language]);

  // Combine API and profile errors.
  const displayError = profileError || error;

  // Track loading for the current profile and GitHub data.
  const isLoading = profileLoading || loading;

  return (
    <main className="repositories-page">
      <div className="repositories-container">

        {/* Back navigation */}
        <Link
          to="/dashboard"
          className="repositories-back"
        >
          <ArrowLeft size={17} />
          Back to dashboard
        </Link>

        {/* Page header */}
        <header className="repositories-header">
          <div>
            <span className="repositories-eyebrow">
              DEVOPS INSIGHT AI
            </span>

            <h1>GitHub Repositories</h1>

            <p>
              Explore public repositories and monitor your
              development projects from one workspace.
            </p>
          </div>

          <div className="repositories-header-icon">
            <GitBranch size={27} />
          </div>
        </header>

        {/* GitHub username form */}
        <section className="repositories-connect-panel">
          <div className="repositories-section-heading">
            <h2>Explore GitHub repositories</h2>

            <p>
              Enter a GitHub username to fetch public
              repositories.
            </p>
          </div>

          <form
            className="repositories-connect-form"
            onSubmit={handleConnect}
          >
            <label
              htmlFor="github-username"
              className="repositories-sr-only"
            >
              GitHub username
            </label>

            <input
              id="github-username"
              type="text"
              placeholder="Enter GitHub username"
              value={inputUsername}
              onChange={(event) =>
                setInputUsername(event.target.value)
              }
              disabled={profileLoading || saving}
              required
              pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?"
              title="Enter a valid GitHub username."
            />

            {/* Save username and load repositories */}
            <button
              type="submit"
              disabled={isLoading || saving}
            >
              {isLoading || saving ? (
                <RefreshCw
                  size={18}
                  className="repo-spin"
                />
              ) : (
                <GitBranch size={18} />
              )}

              {saving
                ? "Saving..."
                : profileLoading
                  ? "Loading profile..."
                  : loading
                    ? "Loading..."
                    : "Load repositories"}
            </button>
          </form>

          <p className="repositories-hint">
            Public repositories only. No GitHub token required.
          </p>
        </section>

        {/* Show database or GitHub API errors */}
        {displayError && (
          <div
            className="repositories-error"
            role="alert"
          >
            <AlertCircle size={20} />
            <span>{displayError}</span>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div
            className="repositories-status"
            role="status"
          >
            <RefreshCw
              size={23}
              className="repo-spin"
            />

            <p>
              {profileLoading
                ? "Loading your profile..."
                : "Fetching repositories from GitHub..."}
            </p>
          </div>
        )}

        {/* Display GitHub profile and repositories */}
        {!isLoading && !displayError && profile && (
          <>
            <section className="repositories-profile">
              <img
                src={profile.avatar_url}
                alt={`${profile.login}'s GitHub avatar`}
              />

              <div>
                <h2>{profile.name || profile.login}</h2>

                <p>@{profile.login}</p>

                <span>
                  {repositories.length} public repositories loaded
                </span>
              </div>

              {/* Refresh GitHub API data */}
              <button
                className="repositories-refresh"
                type="button"
                onClick={refresh}
                aria-label="Refresh repositories"
              >
                <RefreshCw size={18} />
              </button>
            </section>

            {/* Search and language filters */}
            <section className="repositories-toolbar">
              <div className="repositories-search">
                <Search size={18} />

                <input
                  type="search"
                  placeholder="Search repositories..."
                  aria-label="Search repositories"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                />
              </div>

              <select
                aria-label="Filter by language"
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value)
                }
              >
                <option value="all">
                  All languages
                </option>

                {languages.map((item) => (
                  <option
                    key={item}
                    value={item}
                  >
                    {item}
                  </option>
                ))}
              </select>
            </section>

            {/* Repository count */}
            <div className="repositories-results">
              Showing {filteredRepositories.length} of{" "}
              {repositories.length} repositories
            </div>

            {/* Repository cards */}
            {filteredRepositories.length > 0 ? (
              <section className="repositories-grid">
                {filteredRepositories.map((repository) => (
                  <RepositoryCard
                    key={repository.id}
                    repository={repository}
                  />
                ))}
              </section>
            ) : (
              <div className="repositories-status">
                <GitBranch size={28} />

                <h3>No matching repositories</h3>

                <p>
                  Try another search or language filter.
                </p>
              </div>
            )}
          </>
        )}

        {/* Initial empty state */}
        {!isLoading && !displayError && !profile && (
          <div className="repositories-status">
            <GitBranch size={32} />

            <h3>Ready to explore GitHub?</h3>

            <p>
              Enter a username above to get started.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
