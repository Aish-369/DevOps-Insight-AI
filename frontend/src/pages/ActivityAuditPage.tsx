
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
import { useGitHubUsername } from "../hooks/useGitHubUsername";
import { useGitHubRepositories } from "../hooks/useGitHubRepositories";

import {
  fetchRepositoryCommits,
  fetchCommitDetails,
  type GitHubCommit,
  type GitHubCommitDetail,
} from "../lib/githubActivity";

import "../styles/ActivityAuditPage.css";

export default function ActivityAuditPage() {
  // Store the username entered into the form.
  const [usernameInput, setUsernameInput] = useState("");

  // Load the signed-in user's GitHub username from Supabase.
  const {
    username,
    loading: usernameLoading,
    error: usernameError,
    saveUsername,
  } = useGitHubUsername();

  // Fill the input when the saved username becomes available.
  useEffect(() => {
    setUsernameInput(username);
  }, [username]);

  // Load repositories belonging to the saved GitHub username.
  const {
    repositories,
    loading: reposLoading,
    error: reposError,
  } = useGitHubRepositories(
    usernameLoading || usernameError ? "" : username
  );

  // Store the currently selected repository.
  const [selectedRepo, setSelectedRepo] = useState("");

  // Store recent commits.
  const [commits, setCommits] = useState<GitHubCommit[]>([]);

  // Store the currently expanded commit details.
  const [selectedCommit, setSelectedCommit] =
    useState<GitHubCommitDetail | null>(null);

  // Track commit loading, details loading, and errors.
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState("");
  const [detailsError, setDetailsError] = useState("");

  // Increment this value to refresh the commit list.
  const [refreshKey, setRefreshKey] = useState(0);

  // Automatically select a valid repository.
  useEffect(() => {
    if (reposLoading || reposError) return;

    setSelectedRepo((previous) => {
      // Keep the current repository if it is still available.
      if (repositories.some((repo) => repo.full_name === previous)) {
        return previous;
      }

      // Otherwise select the first available repository.
      return repositories[0]?.full_name || "";
    });
  }, [repositories, reposLoading, reposError]);

  // Load recent commits for the selected repository.
  useEffect(() => {
    // Wait until the username and repositories have loaded.
    if (usernameLoading || reposLoading) return;

    // Do not fetch commits when profile or repository loading failed.
    if (usernameError || reposError) {
      setCommits([]);
      setSelectedCommit(null);
      setLoading(false);
      setError("");
      return;
    }

    // Clear the commit list when no repository is selected.
    if (!selectedRepo) {
      setCommits([]);
      setSelectedCommit(null);
      setError("");
      setLoading(false);
      return;
    }

    // Allow outdated requests to be cancelled.
    const controller = new AbortController();

    async function loadCommits() {
      setLoading(true);
      setError("");
      setCommits([]);
      setSelectedCommit(null);
      setDetailsError("");

      try {
        // Split the repository name into owner and repository.
        const [owner, repo] = selectedRepo.split("/");

        if (!owner || !repo) {
          throw new Error("Invalid repository selection.");
        }

        // Fetch recent commits from the public GitHub repository.
        const result = await fetchRepositoryCommits(
          owner,
          repo,
          controller.signal
        );

        // Ignore results from a cancelled request.
        if (!controller.signal.aborted) {
          setCommits(result);
        }
      } catch (err) {
        // Ignore errors from requests that were cancelled.
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load commit activity."
          );
        }
      } finally {
        // Finish loading only for the active request.
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadCommits();

    // Cancel the request if the repository changes.
    return () => controller.abort();
  }, [
    selectedRepo,
    refreshKey,
    usernameLoading,
    usernameError,
    reposLoading,
    reposError,
  ]);

  // Validate and save the username to the signed-in user's profile.
  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Accept a GitHub username or a supported GitHub profile URL.
    const cleanUsername = extractGitHubUsername(usernameInput);

    if (!cleanUsername) {
      setError("Please enter a valid GitHub username.");
      return;
    }

    setError("");
    setDetailsError("");

    // Save the username through Supabase.
    const saved = await saveUsername(cleanUsername);

    // Do not continue if saving failed.
    if (!saved) return;

    // Reset the old repository and commit selection.
    setSelectedRepo("");
    setCommits([]);
    setSelectedCommit(null);

    // Reload repositories and commits using the saved username.
    setRefreshKey((previous) => previous + 1);
  }

  // Refresh the currently selected repository's commits.
  function handleRefresh() {
    setRefreshKey((previous) => previous + 1);
  }

  // Load details when a commit is clicked.
  async function handleCommitClick(commit: GitHubCommit) {
    // Close the details if the same commit is clicked again.
    if (selectedCommit?.sha === commit.sha) {
      setSelectedCommit(null);
      setDetailsError("");
      return;
    }

    // Read the owner and repository from the current selection.
    const [owner, repo] = selectedRepo.split("/");

    if (!owner || !repo) return;

    setSelectedCommit(null);
    setDetailsError("");
    setDetailsLoading(true);

    try {
      // Fetch the commit's changed files and line statistics.
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

  // Combine profile and repository loading states.
  const profileLoading = usernameLoading || reposLoading;

  // Display the first available profile or repository error.
  const profileError = usernameError || reposError;

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

        {/* Let the user save a GitHub username and select a repository. */}
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

              <button
                type="submit"
                disabled={profileLoading}
              >
                {profileLoading ? "Loading..." : "Load"}
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
            disabled={profileLoading || repositories.length === 0}
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

        {/* Display commit history and expandable file changes. */}
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

          {profileError && (
            <p className="audit-error" role="alert">
              {profileError}
            </p>
          )}

          {error && (
            <p className="audit-error" role="alert">
              {error}
            </p>
          )}

          {profileLoading && (
            <p className="audit-status" role="status">
              Loading your GitHub profile and repositories...
            </p>
          )}

          {loading && !profileLoading && (
            <p className="audit-status" role="status">
              Loading GitHub activity...
            </p>
          )}

          {!profileLoading &&
            !loading &&
            !profileError &&
            !error &&
            !selectedRepo && (
              <p className="audit-status">
                Save your GitHub username and choose a repository
                to view its commit history.
              </p>
            )}

          {!profileLoading &&
            !loading &&
            !profileError &&
            !error &&
            selectedRepo &&
            commits.length === 0 && (
              <p className="audit-status">
                No commits found for this repository.
              </p>
            )}

          {!loading && !profileLoading && !error && !profileError && (
            <div className="audit-timeline">
              {commits.map((item) => {
                // Prefer the GitHub login for the commit author.
                const authorName =
                  item.author?.login ||
                  item.commit.author?.name ||
                  "Unknown author";

                // Format the commit date for display.
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
                        onClick={() => void handleCommitClick(item)}
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

                      {/* Render details only after they have loaded. */}
                      {isExpanded && selectedCommit && (
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
