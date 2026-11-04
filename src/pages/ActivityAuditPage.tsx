
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
  // Store the username manually entered by the user.
  const [usernameInputOverride, setUsernameInputOverride] =
    useState<string | null>(null);

  // Load the saved GitHub username from Supabase.
  const {
    username,
    loading: usernameLoading,
    error: usernameError,
    saveUsername,
  } = useGitHubUsername();

  // Use the saved username unless the user edits the input.
  const usernameInput = usernameInputOverride ?? username;

  // Load repositories belonging to the saved GitHub username.
  const {
    repositories,
    loading: reposLoading,
    error: reposError,
  } = useGitHubRepositories(
    usernameLoading || usernameError ? "" : username
  );

  // Store the repository selected by the user.
  const [selectedRepo, setSelectedRepo] = useState("");

  // Keep the selected repository valid when the list changes.
  const activeSelectedRepo = repositories.some(
    (repo) => repo.full_name === selectedRepo
  )
    ? selectedRepo
    : repositories[0]?.full_name || "";

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

  // Load recent commits for the active repository.
  useEffect(() => {
    // Wait until the profile and repositories finish loading.
    if (usernameLoading || reposLoading) return;

    // Do not fetch when profile loading failed or no repository exists.
    if (usernameError || reposError || !activeSelectedRepo) return;

    // Cancel outdated requests when the repository changes.
    const controller = new AbortController();

    async function loadCommits() {
      setLoading(true);
      setError("");
      setCommits([]);
      setSelectedCommit(null);
      setDetailsError("");

      try {
        // Split the repository name into owner and repository.
        const [owner, repo] = activeSelectedRepo.split("/");

        if (!owner || !repo) {
          throw new Error("Invalid repository selection.");
        }

        // Fetch recent commits from the GitHub repository.
        const result = await fetchRepositoryCommits(
          owner,
          repo,
          controller.signal
        );

        // Update commits only if this request is still active.
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

    // Cancel the request if its dependencies change.
    return () => controller.abort();
  }, [
    activeSelectedRepo,
    refreshKey,
    usernameLoading,
    usernameError,
    reposLoading,
    reposError,
  ]);

  // Validate and save the GitHub username.
  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // Accept a GitHub username or supported profile URL.
    const cleanUsername = extractGitHubUsername(usernameInput);

    if (!cleanUsername) {
      setError("Please enter a valid GitHub username.");
      return;
    }

    setError("");
    setDetailsError("");

    // Save the username through Supabase.
    const saved = await saveUsername(cleanUsername);

    // Stop if saving failed.
    if (!saved) return;

    // Use the newly saved username as the input value.
    setUsernameInputOverride(null);

    // Reset the previous repository and commit selection.
    setSelectedRepo("");
    setCommits([]);
    setSelectedCommit(null);

    // Trigger a refresh.
    setRefreshKey((previous) => previous + 1);
  }

  // Refresh the selected repository's commits.
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

    // Read the owner and repository from the active selection.
    const [owner, repo] = activeSelectedRepo.split("/");

    if (!owner || !repo) return;

    setSelectedCommit(null);
    setDetailsError("");
    setDetailsLoading(true);

    try {
      // Fetch the changed files and line statistics.
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
                  setUsernameInputOverride(event.target.value)
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
            value={activeSelectedRepo}
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
              <p>{activeSelectedRepo || "No repository selected"}</p>
            </div>

            <button
              type="button"
              className="audit-refresh"
              onClick={handleRefresh}
              disabled={!activeSelectedRepo || loading}
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
            !activeSelectedRepo && (
              <p className="audit-status">
                Save your GitHub username and choose a repository
                to view its commit history.
              </p>
            )}

          {!profileLoading &&
            !loading &&
            !profileError &&
            !error &&
            activeSelectedRepo &&
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
