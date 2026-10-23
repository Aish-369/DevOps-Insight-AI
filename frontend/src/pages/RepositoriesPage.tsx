
import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import {
  ArrowLeft,
  Search,
  RefreshCw,
  GitBranch,
  AlertCircle,
} from "lucide-react";

import RepositoryCard from "../components/github/RepositoryCard";

import {
  getSavedGitHubUsername,
  saveGitHubUsername,
  useGitHubRepositories,
} from "../hooks/useGitHubRepositories";

// Import the page's CSS styles.
import "../styles/RepositoriesPage.css";

export default function RepositoriesPage() {
  // Store the username entered in the input field.
  const [inputUsername, setInputUsername] = useState(
    getSavedGitHubUsername
  );

  // Store the username used for GitHub API requests.
  const [username, setUsername] = useState(
    getSavedGitHubUsername
  );

  // Store search and language filter values.
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("all");

  // Get GitHub data from our custom React hook.
  const {
    profile,
    repositories,
    loading,
    error,
    refresh,
  } = useGitHubRepositories(username);

  // Run when the user submits the GitHub username.
  function handleConnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = inputUsername.trim();

    if (!cleanUsername) {
      return;
    }

    // Save the username for future visits.
    saveGitHubUsername(cleanUsername);

    // Update the username used by the API hook.
    setUsername(cleanUsername);

    // Reset the search and filter.
    setSearch("");
    setLanguage("all");

    // Reload data if the same username is submitted again.
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

      const matchesSearch =
        repository.name.toLowerCase().includes(query) ||
        (repository.description || "")
          .toLowerCase()
          .includes(query);

      const matchesLanguage =
        language === "all" ||
        repository.language === language;

      return matchesSearch && matchesLanguage;
    });
  }, [repositories, search, language]);

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
              required
              pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?"
              title="Enter a valid GitHub username."
            />

            {/* Submit button */}
            <button type="submit" disabled={loading}>
              <GitBranch size={18} />

              {loading
                ? "Loading..."
                : "Load repositories"}
            </button>
          </form>

          <p className="repositories-hint">
            Public repositories only. No GitHub token required.
          </p>
        </section>

        {/* API error message */}
        {error && (
          <div
            className="repositories-error"
            role="alert"
          >
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div
            className="repositories-status"
            role="status"
          >
            <RefreshCw
              size={23}
              className="repo-spin"
            />

            <p>Fetching repositories from GitHub...</p>
          </div>
        )}

        {/* Display GitHub profile and repositories */}
        {!loading && !error && profile && (
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

              {/* Refresh API data */}
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
        {!loading && !error && !profile && (
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
