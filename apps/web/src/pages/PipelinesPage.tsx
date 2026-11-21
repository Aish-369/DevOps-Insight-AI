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

// Store workflow results with their request key.
type PipelineResult = {
    requestKey: string;
    runs: PipelineRun[];
    error: string;
};

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

    // Store the user's repository selection.
    const [selectedRepo, setSelectedRepo] = useState("");

    // Changing this value triggers a workflow refresh.
    const [refreshKey, setRefreshKey] = useState(0);

    // Store the latest workflow request result.
    const [pipelineResult, setPipelineResult] =
        useState<PipelineResult | null>(null);

    // Keep the selected repository if it still exists.
    const selectedRepositoryExists = repositories.some(
        (repo) => repo.full_name === selectedRepo
    );

    // Automatically use the first repository when needed.
    const activeSelectedRepo = selectedRepositoryExists
        ? selectedRepo
        : repositories[0]?.full_name ?? "";

    // Identify the current workflow request.
    const requestKey = JSON.stringify([
        activeSelectedRepo,
        refreshKey,
    ]);

    // Only use results belonging to the current request.
    const currentPipelineResult =
        pipelineResult?.requestKey === requestKey
            ? pipelineResult
            : null;

    // Derive workflow runs and errors from the current result.
    const runs = currentPipelineResult?.runs ?? [];
    const error = currentPipelineResult?.error ?? "";

    // Combine profile and repository loading states.
    const profileLoading = usernameLoading || reposLoading;

    // Combine profile and repository errors for display.
    const profileError = usernameError || reposError;

    // Determine whether workflow data is currently loading.
    const loading =
        !profileLoading &&
        !profileError &&
        Boolean(username) &&
        Boolean(activeSelectedRepo) &&
        !currentPipelineResult;

    // Fetch workflows when the selected repository changes.
    useEffect(() => {
        // Wait until the username and repositories have loaded.
        if (usernameLoading || reposLoading) {
            return;
        }

        // Do not fetch when the profile has an error.
        if (usernameError || reposError || !username) {
            return;
        }

        // Stop when no repository is available.
        if (!activeSelectedRepo) {
            return;
        }

        // Split "owner/repository" into separate values.
        const [owner, repo] = activeSelectedRepo.split("/");

        if (!owner || !repo) {
            return;
        }

        // Create a controller to cancel outdated requests.
        const controller = new AbortController();

        async function loadRuns() {
            try {
                // Ask GitHub for the repository's workflow runs.
                const result = await fetchPipelineRuns(
                    owner,
                    repo,
                    controller.signal
                );

                // Ignore results from a cancelled request.
                if (!controller.signal.aborted) {
                    setPipelineResult({
                        requestKey,
                        runs: result,
                        error: "",
                    });
                }
            } catch (err) {
                // Ignore errors from requests that were cancelled.
                if (controller.signal.aborted) {
                    return;
                }

                setPipelineResult({
                    requestKey,
                    runs: [],
                    error:
                        err instanceof Error
                            ? err.message
                            : "Unable to load pipeline runs.",
                });
            }
        }

        // Start loading workflow runs.
        void loadRuns();

        // Cancel the request if the selection changes or the page unmounts.
        return () => controller.abort();
    }, [
        activeSelectedRepo,
        requestKey,
        username,
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
                                value={activeSelectedRepo}
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
                                    !activeSelectedRepo ||
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
                                !activeSelectedRepo &&
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
                                activeSelectedRepo &&
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
