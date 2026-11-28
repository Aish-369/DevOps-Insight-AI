import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Search, Workflow } from "lucide-react";
import { supabase } from "../lib/supabase";
import { resolveActiveWorkspaceId, saveActiveWorkspaceId } from "../lib/workspaceSelection.js";
import "./PlatformPages.css";

type Team = { id: string; name: string; role: string };
type Run = {
  github_run_id: number;
  team_id: string;
  github_repo_id: number;
  workflow_name: string;
  run_number: number;
  run_attempt: number;
  head_branch: string | null;
  head_sha: string | null;
  event: string | null;
  status: string | null;
  conclusion: string | null;
  html_url: string | null;
  run_started_at: string | null;
  completed_at: string | null;
};
type Repository = { github_repo_id: number; full_name: string };
type Analysis = {
  id: string;
  github_run_id: number;
  category: string | null;
  cause: string | null;
  confidence: "high" | "medium" | "low" | null;
  fix_steps: string[];
  evidence: string[];
  created_at: string;
};

function statusClass(run: Run): string {
  if (run.status !== "completed") return "platform-status-running";
  if (run.conclusion === "success") return "platform-status-success";
  if (run.conclusion === "failure") return "platform-status-failure";
  return "platform-status-neutral";
}

export default function WorkflowRunsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzingRunId, setAnalyzingRunId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const repositoryNames = useMemo(
    () => new Map(repositories.map((repository) => [repository.github_repo_id, repository.full_name])),
    [repositories],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Your sign-in session has expired.");
      setCurrentUserId(authData.user.id);

      const [{ data: teamRows, error: teamsError }, { data: membershipRows, error: membershipError }] = await Promise.all([
        supabase.from("teams").select("id,name").order("created_at", { ascending: true }),
        supabase.from("team_members").select("team_id,role").eq("user_id", authData.user.id),
      ]);
      if (teamsError) throw teamsError;
      if (membershipError) throw membershipError;
      const roleByTeam = new Map((membershipRows ?? []).map((row) => [row.team_id, row.role]));
      const loadedTeams = (teamRows ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        role: String(roleByTeam.get(team.id) ?? "member"),
      }));
      setTeams(loadedTeams);
      const selectedTeamId = resolveActiveWorkspaceId(authData.user.id, teamId, loadedTeams) ?? "";
      saveActiveWorkspaceId(authData.user.id, selectedTeamId || null);
      setTeamId(selectedTeamId);

      if (!selectedTeamId) {
        setRuns([]);
        setRepositories([]);
        setAnalyses([]);
        return;
      }

      const [{ data: runRows, error: runsError }, { data: repositoryRows, error: repositoryError }, { data: analysisRows, error: analysisError }] = await Promise.all([
        supabase.from("workflow_runs").select("github_run_id,team_id,github_repo_id,workflow_name,run_number,run_attempt,head_branch,head_sha,event,status,conclusion,html_url,run_started_at,completed_at")
          .eq("team_id", selectedTeamId).order("run_started_at", { ascending: false }).limit(100),
        supabase.from("team_repositories").select("github_repo_id,full_name").eq("team_id", selectedTeamId),
        supabase.from("failure_analyses").select("id,github_run_id,category,cause,confidence,fix_steps,evidence,created_at")
          .eq("team_id", selectedTeamId).order("created_at", { ascending: false }).limit(100),
      ]);
      if (runsError) throw runsError;
      if (repositoryError) throw repositoryError;
      if (analysisError) throw analysisError;
      setRuns((runRows ?? []) as Run[]);
      setRepositories((repositoryRows ?? []) as Repository[]);
      setAnalyses((analysisRows ?? []) as Analysis[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load workflow history.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadData();
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  async function analyze(runId: number) {
    setAnalyzingRunId(runId);
    setError("");
    setNotice("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("analyze-failed-run", {
        body: { team_id: teamId, run_id: runId },
      });
      if (requestError) throw requestError;
      if (!data?.ok || !data.analysis) throw new Error("The analysis did not complete.");
      setNotice(data.reused ? "An existing analysis was reused." : "Failure diagnostics completed.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failure diagnostics are not available.");
    } finally {
      setAnalyzingRunId(null);
    }
  }

  return (
    <main className="platform-page platform-wide">
      <header className="platform-header">
        <div>
          <p className="platform-eyebrow">DEVOPS INSIGHT AI / MONITORING</p>
          <h1>Workflow runs</h1>
          <p>Team-scoped GitHub Actions history, job outcomes and evidence-based failure analysis.</p>
        </div>
        <Link to="/dashboard">Back to workspace</Link>
      </header>
      <section className="platform-card">
        <label htmlFor="workflow-team">Workspace</label>
        <select id="workflow-team" value={teamId} onChange={(event) => { const nextId = event.target.value; setTeamId(nextId); saveActiveWorkspaceId(currentUserId, nextId || null); }} disabled={loading || teams.length === 0}>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <div className="platform-actions">
          <button type="button" className="platform-secondary" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {error && <p className="platform-error" role="alert">{error}</p>}
        {notice && <p className="platform-success" role="status">{notice}</p>}
      </section>
      <section className="platform-card">
        <h2><Workflow size={18} /> Recent workflow activity</h2>
        {loading ? <p role="status">Loading workflow runs…</p> : runs.length === 0 ? (
          <p className="platform-muted">No workflow runs have been received for this workspace. Connect a GitHub App installation and configure its webhook.</p>
        ) : runs.map((run) => {
          const analysis = analyses.find((item) => item.github_run_id === run.github_run_id);
          const runFailed = run.status === "completed" && run.conclusion !== "success";
          return (
            <article className="platform-run-card" key={run.github_run_id}>
              <div className="platform-run-heading">
                <div>
                  <strong>{run.workflow_name}</strong>
                  <p>{repositoryNames.get(run.github_repo_id) ?? "Repository " + run.github_repo_id} · #{run.run_number} · {run.head_branch ?? "unknown branch"}</p>
                  <small>{run.completed_at ? new Date(run.completed_at).toLocaleString() : run.run_started_at ? new Date(run.run_started_at).toLocaleString() : "Date unavailable"}</small>
                </div>
                <span className={"platform-status " + statusClass(run)}>{run.conclusion ?? run.status ?? "unknown"}</span>
              </div>
              <div className="platform-actions">
                {run.html_url && <a href={run.html_url} target="_blank" rel="noreferrer">Open run ↗</a>}
                {runFailed && (
                  <button type="button" onClick={() => void analyze(run.github_run_id)} disabled={analyzingRunId === run.github_run_id}>
                    <Search size={15} /> {analyzingRunId === run.github_run_id ? "Analyzing…" : analysis ? "Re-analyze failure" : "Analyze failure"}
                  </button>
                )}
              </div>
              {analysis && (
                <div className="platform-analysis">
                  <div className="platform-run-heading">
                    <strong>{analysis.category ?? "Failure analysis"}</strong>
                    <span className="platform-status platform-status-neutral">{analysis.confidence ?? "unknown"} confidence</span>
                  </div>
                  <p>{analysis.cause}</p>
                  {analysis.evidence?.length > 0 && (
                    <>
                      <h3>Evidence</h3>
                      <ul>{analysis.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul>
                    </>
                  )}
                  {analysis.fix_steps?.length > 0 && (
                    <>
                      <h3>Suggested next steps</h3>
                      <ol>{analysis.fix_steps.map((item, index) => <li key={index}>{item}</li>)}</ol>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
      <p className="platform-muted">Diagnostics use deterministic log signatures, not a hosted AI model. Treat suggestions as hypotheses and review the linked logs and evidence before acting.</p>
    </main>
  );
}
