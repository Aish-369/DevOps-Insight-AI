
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  ExternalLink,
  GitCommitHorizontal,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileCode2,
} from "lucide-react";

import { extractGitHubUsername } from "../lib/github";
import "../styles/ActivityAuditPage.css";
import {
  getSavedGitHubUsername,
  saveGitHubUsername,
  useGitHubRepositories,
} from "../hooks/useGitHubRepositories";

import {
  fetchRepositoryCommits,
  fetchCommitDetails,
  type GitHubCommit,
  type GitHubCommitDetail,
} from "../lib/githubActivity";

import "../styles/ActivityAuditPage.css";

export default function ActivityAuditPage() {
  // Load the previously saved GitHub username.
  const [usernameInput, setUsernameInput] = useState(
    getSavedGitHubUsername
  );

  // Store the username used to fetch repositories.
  const [username, setUsername] = useState(getSavedGitHubUsername);

  // Store the currently selected repository.
  const [selectedRepo, setSelectedRepo] = useState("");

  // Store the recent commits.
  const [commits, setCommits] = useState<GitHubCommit[]>([]);

  // Store the details of the selected commit.
  const [selectedCommit, setSelectedCommit] =
    useState<GitHubCommitDetail | null>(null);

  // Track loading and error states separately.
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Reuse the existing repository-loading hook.
  const {
    repositories,
    loading: reposLoading,
    error: reposError,
  } = useGitHubRepositories(username);

  // Keep the selected repository valid when repositories change.
  useEffect(() => {
    if (reposLoading || reposError) return;

    setSelectedRepo((previous) => {
      if (repositories.some((repo) => repo.full_name === previous)) {
        return previous;
      }

      return repositories[0]?.full_name || "";
    });
  }, [repositories, reposLoading, reposError]);

  // Load recent commits whenever the repository changes.
  useEffect(() => {
    if (!selectedRepo) {
      setCommits([]);
      setSelectedCommit(null);
      setError("");
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadCommits() {
      setLoading(true);
      setError("");
      setCommits([]);
      setSelectedCommit(null);
      setDetailsError("");

      try {
        // Split "owner/repository" into two values.
        const [owner, repo] = selectedRepo.split("/");

        const result = await fetchRepositoryCommits(
          owner,
          repo,
          controller.signal
        );

        // Update the page only if this request is still active.
        if (!controller.signal.aborted) {
          setCommits(result);
        }
      } catch (err) {
        if (controller.signal.aborted) return;

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load commit activity."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCommits();

    // Cancel the old request when the repository changes.
    return () => controller.abort();
  }, [selectedRepo, refreshKey]);

  // Load detailed information when a commit is selected.
  async function handleCommitClick(commit: GitHubCommit) {
    // Clicking the open commit closes its details.
    if (selectedCommit?.sha === commit.sha) {
      setSelectedCommit(null);
      setDetailsError("");
      return;
    }

    const [owner, repo] = selectedRepo.split("/");

    if (!owner || !repo) return;

    // Clear the previous details before loading new ones.
    setSelectedCommit(null);
    setDetailsError("");
    setDetailsLoading(true);

    try {
      const details = await fetchCommitDetails(
        owner,
        repo,
        commit.sha
      );

      setSelectedCommit(details);
    } catch (err) {
      setDetailsError(
        err instanceof Error
          ? err.message
          : "Unable to load commit details."
      );
    } finally {
      setDetailsLoading(false);
    }
  }

  // Validate and save a new GitHub username.
  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanUsername = extractGitHubUsername(usernameInput);

    if (!cleanUsername) {
      setError("Please enter a valid GitHub username.");
      return;
    }

    setSelectedRepo("");
    setCommits([]);
    setSelectedCommit(null);
    setError("");
    setDetailsError("");

    saveGitHubUsername(cleanUsername);
    setUsername(cleanUsername);
  }

  // Reload the commit list for the selected repository.
  function handleRefresh() {
    setRefreshKey((previous) => previous + 1);
  }

  return (
    <main className="audit-page">
      <div className="audit-container">
        <Link to="/dashboard" className="audit-back">
          <ArrowLeft size={17} />
          Back to dashboard
        </Link>

        <header className="audit-header">
          <div>
            <p className="audit-eyebrow">DEVOPS INSIGHT AI</p>
            <h1>Activity Audit</h1>
            <p>
              Explore recent commits and inspect changed files in
              public GitHub repositories.
            </p>
          </div>

          <div className="audit-header-icon">
            <Activity size={28} />
          </div>
        </header>

        {/* Repository selection */}
        <section className="audit-panel">
          <h2>Repository selection</h2>

          <form className="audit-search" onSubmit={handleSearch}>
            <label htmlFor="audit-username">
              GitHub username
            </label>

            <div className="audit-search-row">
              <input
                id="audit-username"
                value={usernameInput}
                onChange={(event) =>
                  setUsernameInput(event.target.value)
                }
                placeholder="Enter GitHub username"
                required
              />

              <button type="submit" disabled={reposLoading}>
                {reposLoading ? "Loading..." : "Load"}
              </button>
            </div>
          </form>

          <label htmlFor="audit-repository">
            Select repository
          </label>

          <select
            id="audit-repository"
            value={selectedRepo}
            onChange={(event) =>
              setSelectedRepo(event.target.value)
            }
            disabled={reposLoading || repositories.length === 0}
          >
            <option value="">Select a repository</option>

            {repositories.map((repo) => (
              <option key={repo.id} value={repo.full_name}>
                {repo.name}
              </option>
            ))}
          </select>

          <p className="audit-hint">
            Public repositories only. Up to 30 recent commits from
            the default branch.
          </p>
        </section>

        {/* Recent commits and expandable details */}
        <section className="audit-panel">
          <div className="audit-section-heading">
            <div>
              <h2>Recent commits</h2>
              <p>{selectedRepo || "No repository selected"}</p>
            </div>

            <button
              type="button"
              className="audit-refresh"
              onClick={handleRefresh}
              disabled={!selectedRepo || loading}
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>

          {reposError && (
            <p className="audit-error" role="alert">
              {reposError}
            </p>
          )}

          {error && (
            <p className="audit-error" role="alert">
              {error}
            </p>
          )}

          {(loading || reposLoading) && (
            <p className="audit-status" role="status">
              Loading GitHub activity...
            </p>
          )}

          {!loading &&
            !reposLoading &&
            !error &&
            !reposError &&
            selectedRepo &&
            commits.length === 0 && (
              <p className="audit-status">
                No commits found for this repository.
              </p>
            )}

          {!loading &&
            !reposLoading &&
            !selectedRepo &&
            !reposError &&
            !error && (
              <p className="audit-status">
                Choose a repository to view its commit history.
              </p>
            )}

          {!loading && !reposLoading && !error && !reposError && (
            <div className="audit-timeline">
              {commits.map((item) => {
                // Use the GitHub login or fall back to the commit name.
                const authorName =
                  item.author?.login ||
                  item.commit.author?.name ||
                  "Unknown author";

                const date = item.commit.author?.date
                  ? new Date(
                      item.commit.author.date
                    ).toLocaleString()
                  : "Date unavailable";

                // Check whether this commit's details are expanded.
                const isExpanded =
                  selectedCommit?.sha === item.sha;

                return (
                  <article className="audit-commit" key={item.sha}>
                    <div className="audit-commit-icon">
                      <GitCommitHorizontal size={19} />
                    </div>

                    <div className="audit-commit-content">
                      <button
                        type="button"
                        className="audit-commit-toggle"
                        onClick={() => handleCommitClick(item)}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <ChevronDown size={17} />
                        ) : (
                          <ChevronRight size={17} />
                        )}

                        <span>
                          {item.commit.message.split("\n")[0]}
                        </span>
                      </button>

                      <p className="audit-commit-meta">
                        {authorName} · {date}
                      </p>

                      <div className="audit-commit-footer">
                        <code>{item.sha.slice(0, 7)}</code>

                        <a
                          href={item.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View on GitHub
                          <ExternalLink size={14} />
                        </a>
                      </div>

                      {/* Show the detailed commit information. */}
                      {isExpanded && (
                        <div className="audit-commit-details">
                          <h4>Commit details</h4>

                          <div className="audit-change-stats">
                            <span>
                              Files changed:{" "}
                              {selectedCommit.files.length}
                            </span>

                            <span className="audit-additions">
                              +{selectedCommit.stats.additions} additions
                            </span>

                            <span className="audit-deletions">
                              -{selectedCommit.stats.deletions} deletions
                            </span>
                          </div>

                          <p className="audit-hint">
                            Total changed lines:{" "}
                            {selectedCommit.stats.total}
                          </p>

                          <h4>Changed files</h4>

                          {selectedCommit.files.length === 0 ? (
                            <p className="audit-status">
                              No file details were returned by GitHub.
                            </p>
                          ) : (
                            <div className="audit-file-list">
                              {selectedCommit.files.map((file) => (
                                <details
                                  className="audit-file"
                                  key={`${item.sha}-${file.filename}`}
                                >
                                  <summary>
                                    <FileCode2 size={16} />

                                    <span className="audit-file-name">
                                      {file.filename}
                                    </span>

                                    <span className="audit-file-status">
                                      {file.status}
                                    </span>
                                  </summary>

                                  <p className="audit-file-stats">
                                    +{file.additions} additions · -
                                    {file.deletions} deletions ·{" "}
                                    {file.changes} changes
                                  </p>

                                  {file.previous_filename && (
                                    <p className="audit-hint">
                                      Previous name:{" "}
                                      {file.previous_filename}
                                    </p>
                                  )}

                                  {file.patch ? (
                                    <pre className="audit-patch">
                                      <code>{file.patch}</code>
                                    </pre>
                                  ) : (
                                    <p className="audit-status">
                                      Patch text is unavailable for this
                                      file. Open it on GitHub to inspect
                                      the full diff.
                                    </p>
                                  )}

                                  {file.blob_url && (
                                    <a
                                      href={file.blob_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      Open file on GitHub
                                      <ExternalLink size={14} />
                                    </a>
                                  )}
                                </details>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {detailsLoading && (
            <p className="audit-status" role="status">
              Loading commit details...
            </p>
          )}

          {detailsError && (
            <p className="audit-error" role="alert">
              {detailsError}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
