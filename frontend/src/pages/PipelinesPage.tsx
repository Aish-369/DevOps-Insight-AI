
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Clock3,
  RefreshCw,
  GitBranch,
  Workflow,
} from "lucide-react";

import {
  getSavedGitHubUsername,
  useGitHubRepositories,
} from "../hooks/useGitHubRepositories";

import {
  fetchPipelineRuns,
  type PipelineRun,
} from "../lib/pipelines";

import "../styles/PipelinesPage.css";

// Return the correct label and style for a workflow run.
function getRunStatus(run: PipelineRun) {
  if (run.status !== "completed") {
    return {
      label: run.status.replaceAll("_", " "),
      className: "running",
    };
  }

  if (run.conclusion === "success") {
    return { label: "Success", className: "success" };
  }

  if (run.conclusion === "failure") {
    return { label: "Failed", className: "failed" };
  }

  return {
    label: run.conclusion?.replaceAll("_", " ") || "Unknown",
    className: "neutral",
  };
}

export default function PipelinesPage() {
  // Read the username saved on the repositories page.
  const [username] = useState(getSavedGitHubUsername);

  // Load the user's public repositories.
  const { repositories, loading: reposLoading } =
    useGitHubRepositories(username);

  const [selectedRepo, setSelectedRepo] = useState("");
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Automatically select the first repository.
  useEffect(() => {
    if (
      repositories.length > 0 &&
      !repositories.some(
        (repo) => repo.full_name === selectedRepo
      )
    ) {
      setSelectedRepo(repositories[0].full_name);
    }
  }, [repositories, selectedRepo]);

  // Fetch workflows when the selected repository changes.
  useEffect(() => {
    if (!selectedRepo) {
      setRuns([]);
      return;
    }

    const controller = new AbortController();

    async function loadRuns() {
      setLoading(true);
      setError("");
      setRuns([]);

      try {
        const [owner, repo] = selectedRepo.split("/");

        const result = await fetchPipelineRuns(
          owner,
          repo,
          controller.signal
        );

        if (!controller.signal.aborted) {
          setRuns(result);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to load pipeline runs."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadRuns();

    // Cancel outdated requests.
    return () => controller.abort();
  }, [selectedRepo, refreshKey]);

  const successful = runs.filter(
    (run) => run.conclusion === "success"
  ).length;

  const failed = runs.filter(
    (run) => run.conclusion === "failure"
  ).length;

  const running = runs.filter(
    (run) => run.status !== "completed"
  ).length;

  return (
    <main className="pipelines-page">
      <div className="pipelines-container">
        <Link to="/dashboard" className="pipelines-back">
          <ArrowLeft size={18} />
          Back to dashboard
        </Link>

        <header className="pipelines-header">
          <div>
            <span className="pipelines-eyebrow">
              DEVOPS INSIGHT AI
            </span>
            <h1>CI/CD Pipeline Monitoring</h1>
            <p>
              Monitor real GitHub Actions workflow runs
              across your public repositories.
            </p>
          </div>
          <div className="pipelines-header-icon">
            <Workflow size={28} />
          </div>
        </header>

        <section className="pipelines-panel">
          <div className="pipelines-toolbar">
            <div>
              <h2>Select repository</h2>
              <p>Choose a project to view its workflow runs.</p>
            </div>

            <div className="pipelines-controls">
              <select
                aria-label="Select repository"
                value={selectedRepo}
                disabled={reposLoading || repositories.length === 0}
                onChange={(event) =>
                  setSelectedRepo(event.target.value)
                }
              >
                {repositories.length === 0 && (
                  <option value="">No repositories loaded</option>
                )}

                {repositories.map((repo) => (
                  <option
                    key={repo.id}
                    value={repo.full_name}
                  >
                    {repo.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setRefreshKey((value) => value + 1)}
                disabled={!selectedRepo || loading}
              >
                <RefreshCw size={17} />
                Refresh
              </button>
            </div>
          </div>
        </section>

        {!username && (
          <section className="pipelines-empty">
            <GitBranch size={30} />
            <h3>Connect GitHub first</h3>
            <p>Load a GitHub username on the repositories page.</p>
            <Link to="/repositories">Go to repositories</Link>
          </section>
        )}

        {username && (
          <>
            <section className="pipelines-stats">
              <article className="pipelines-stat">
                <Workflow size={23} />
                <span>Total runs</span>
                <strong>{runs.length}</strong>
              </article>

              <article className="pipelines-stat">
                <CheckCircle2 size={23} />
                <span>Successful</span>
                <strong>{successful}</strong>
              </article>

              <article className="pipelines-stat">
                <XCircle size={23} />
                <span>Failed</span>
                <strong>{failed}</strong>
              </article>

              <article className="pipelines-stat">
                <Clock3 size={23} />
                <span>In progress / queued</span>
                <strong>{running}</strong>
              </article>
            </section>

            <section className="pipelines-panel">
              <h2>Recent workflow runs</h2>
              <p className="pipelines-subtitle">
                Latest 30 runs returned by GitHub Actions.
              </p>

              {(loading || reposLoading) && (
                <div className="pipelines-empty" role="status">
                  <RefreshCw size={25} className="pipelines-spin" />
                  <p>Loading pipeline data...</p>
                </div>
              )}

              {!loading && error && (
                <div className="pipelines-error" role="alert">
                  {error}
                </div>
              )}

              {!loading &&
                !reposLoading &&
                !error &&
                selectedRepo &&
                runs.length === 0 && (
                  <div className="pipelines-empty">
                    <Workflow size={30} />
                    <h3>No workflow runs found</h3>
                    <p>
                      This repository has no accessible GitHub
                      Actions runs yet.
                    </p>
                  </div>
                )}

              {!loading && !error && runs.length > 0 && (
                <div className="pipelines-run-list">
                  {runs.map((run) => {
                    const status = getRunStatus(run);

                    return (
                      <article
                        key={run.id}
                        className="pipelines-run"
                      >
                        <div className="pipelines-run-main">
                          <div className="pipelines-run-icon">
                            <Workflow size={20} />
                          </div>

                          <div>
                            <h3>
                              {run.name || run.display_title}
                            </h3>
                            <p>
                              #{run.run_number} ·{" "}
                              {run.head_branch || "Unknown branch"}
                              {" · "}
                              {run.event}
                            </p>
                            <small>
                              {new Date(
                                run.created_at
                              ).toLocaleString()}
                            </small>
                          </div>
                        </div>

                        <div className="pipelines-run-actions">
                          <span
                            className={`pipelines-status ${status.className}`}
                          >
                            {status.label}
                          </span>

                          <a
                            href={run.html_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Open workflow run on GitHub"
                          >
                            <ArrowUpRight size={19} />
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
