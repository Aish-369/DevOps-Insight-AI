
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

import { useGitHubRepositories } from "../hooks/useGitHubRepositories";
import { useGitHubUsername } from "../hooks/useGitHubUsername";

import {
    fetchPipelineRuns,
    type PipelineRun,
} from "../lib/pipelines";

import "../styles/PipelinesPage.css";

// Return the correct label and style for a workflow run.
function getRunStatus(run: PipelineRun) {
    // Show a running style for workflows that are not completed.
    if (run.status !== "completed") {
        return {
            label: run.status.replaceAll("_", " "),
            className: "running",
        };
    }

    // Show success when the workflow completed successfully.
    if (run.conclusion === "success") {
        return { label: "Success", className: "success" };
    }

    // Show failure when the workflow failed.
    if (run.conclusion === "failure") {
        return { label: "Failed", className: "failed" };
    }

    // Handle cancelled, skipped, or unknown conclusions.
    return {
        label: run.conclusion?.replaceAll("_", " ") || "Unknown",
        className: "neutral",
    };
}

export default function PipelinesPage() {
    // Load the GitHub username belonging to the signed-in user.
    const {
        username,
        loading: usernameLoading,
        error: usernameError,
    } = useGitHubUsername();

    // Load repositories using the saved username from Supabase.
    const {
        repositories,
        loading: reposLoading,
        error: reposError,
    } = useGitHubRepositories(
        usernameLoading || usernameError ? "" : username
    );

    // Store the currently selected repository.
    const [selectedRepo, setSelectedRepo] = useState("");

    // Store the workflow runs returned by GitHub.
    const [runs, setRuns] = useState<PipelineRun[]>([]);

    // Track workflow loading and error states.
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Changing this value triggers a workflow refresh.
    const [refreshKey, setRefreshKey] = useState(0);

    // Automatically select the first available repository.
    useEffect(() => {
        if (repositories.length === 0) {
            setSelectedRepo("");
            setRuns([]);
            return;
        }

        // Keep the current selection if it still exists.
        const selectedStillExists = repositories.some(
            (repo) => repo.full_name === selectedRepo
        );

        // Otherwise select the first repository.
        if (!selectedStillExists) {
            setSelectedRepo(repositories[0].full_name);
        }
    }, [repositories, selectedRepo]);

    // Fetch workflows when the selected repository changes.
    useEffect(() => {
        // Do not fetch while the username or repositories are loading.
        if (usernameLoading || reposLoading) {
            return;
        }

        // Stop when the profile has an error or no repository is selected.
        if (usernameError || reposError || !selectedRepo) {
            setRuns([]);
            setLoading(false);
            setError(usernameError || reposError || "");
            return;
        }

        // Create a controller to cancel outdated requests.
        const controller = new AbortController();

        async function loadRuns() {
            setLoading(true);
            setError("");
            setRuns([]);

            try {
                // Split "owner/repository" into separate values.
                const [owner, repo] = selectedRepo.split("/");

                // Ask GitHub for the repository's workflow runs.
                const result = await fetchPipelineRuns(
                    owner,
                    repo,
                    controller.signal
                );

                // Ignore results from a cancelled request.
                if (!controller.signal.aborted) {
                    setRuns(result);
                }
            } catch (err) {
                // Ignore errors from requests that were cancelled.
                if (!controller.signal.aborted) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Unable to load pipeline runs."
                    );
                }
            } finally {
                // Update loading only for the active request.
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        }

        // Start loading workflow runs.
        void loadRuns();

        // Cancel the request if the selection changes or the page unmounts.
        return () => controller.abort();
    }, [
        selectedRepo,
        refreshKey,
        usernameLoading,
        usernameError,
        reposLoading,
        reposError,
    ]);

    // Count successful workflow runs.
    const successful = runs.filter(
        (run) => run.conclusion === "success"
    ).length;

    // Count failed workflow runs.
    const failed = runs.filter(
        (run) => run.conclusion === "failure"
    ).length;

    // Count workflows that are still running or queued.
    const running = runs.filter(
        (run) => run.status !== "completed"
    ).length;

    // Count cancelled workflow runs.
    const cancelled = runs.filter(
        (run) => run.conclusion === "cancelled"
    ).length;

    // Wait until the user's GitHub profile has loaded.
    const profileLoading = usernameLoading || reposLoading;

    // Combine profile and repository errors for display.
    const profileError = usernameError || reposError;

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
                            <p>
                                Choose a project to view its workflow runs.
                            </p>
                        </div>

                        <div className="pipelines-controls">
                            <select
                                aria-label="Select repository"
                                value={selectedRepo}
                                disabled={
                                    profileLoading ||
                                    repositories.length === 0
                                }
                                onChange={(event) =>
                                    setSelectedRepo(event.target.value)
                                }
                            >
                                {repositories.length === 0 && (
                                    <option value="">
                                        No repositories loaded
                                    </option>
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
                                onClick={() =>
                                    setRefreshKey((value) => value + 1)
                                }
                                disabled={
                                    !selectedRepo ||
                                    loading ||
                                    profileLoading
                                }
                            >
                                <RefreshCw size={17} />
                                Refresh
                            </button>
                        </div>
                    </div>
                </section>

                {profileLoading && (
                    <section className="pipelines-empty" role="status">
                        <RefreshCw
                            size={25}
                            className="pipelines-spin"
                        />
                        <p>Loading your GitHub profile and repositories...</p>
                    </section>
                )}

                {!profileLoading && !username && !profileError && (
                    <section className="pipelines-empty">
                        <GitBranch size={30} />
                        <h3>Connect GitHub first</h3>
                        <p>
                            Save your GitHub username on the repositories page.
                        </p>
                        <Link to="/repositories">
                            Go to repositories
                        </Link>
                    </section>
                )}

                {!profileLoading && profileError && (
                    <section className="pipelines-error" role="alert">
                        {profileError}
                    </section>
                )}

                {!profileLoading && username && !profileError && (
                    <>
                        <section className="pipelines-stats">
                            <article className="pipelines-stat">
                                <Workflow size={23} />
                                <span>Total runs</span>
                                <strong>{runs.length}</strong>
                            </article>

                            <article className="pipelines-stat">
                                <XCircle size={23} />
                                <span>Cancelled</span>
                                <strong>{cancelled}</strong>
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

                            {loading && (
                                <div
                                    className="pipelines-empty"
                                    role="status"
                                >
                                    <RefreshCw
                                        size={25}
                                        className="pipelines-spin"
                                    />
                                    <p>Loading pipeline data...</p>
                                </div>
                            )}

                            {!loading && error && (
                                <div
                                    className="pipelines-error"
                                    role="alert"
                                >
                                    {error}
                                </div>
                            )}

                            {!loading &&
                                !error &&
                                !selectedRepo &&
                                repositories.length === 0 && (
                                    <div className="pipelines-empty">
                                        <GitBranch size={30} />
                                        <h3>No repositories found</h3>
                                        <p>
                                            Add a valid GitHub username on the
                                            repositories page to load repositories.
                                        </p>
                                        <Link to="/repositories">
                                            Go to repositories
                                        </Link>
                                    </div>
                                )}

                            {!loading &&
                                !error &&
                                selectedRepo &&
                                runs.length === 0 && (
                                    <div className="pipelines-empty">
                                        <Workflow size={30} />
                                        <h3>No workflow runs found</h3>
                                        <p>
                                            This repository has no accessible
                                            GitHub Actions runs yet.
                                        </p>
                                    </div>
                                )}

                            {!loading &&
                                !error &&
                                runs.length > 0 && (
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
                                                                {run.name ||
                                                                    run.display_title}
                                                            </h3>

                                                            <p>
                                                                #{run.run_number}
                                                                {" · "}
                                                                {run.head_branch ||
                                                                    "Unknown branch"}
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
                                                            <ArrowUpRight
                                                                size={19}
                                                            />
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
