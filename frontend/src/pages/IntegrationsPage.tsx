import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, GitBranch } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./PlatformPages.css";

type Team = { id: string; name: string };
type Installation = {
  installation_id: number;
  team_id: string;
  account_login: string;
  account_type: string;
  repository_selection: string;
  suspended_at: string | null;
  deleted_at: string | null;
  last_reconciled_at: string | null;
};
type Repository = {
  github_repo_id: number;
  full_name: string;
  default_branch: string | null;
  is_private: boolean;
  active: boolean;
  last_synced_at: string | null;
};

export default function IntegrationsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const activeInstallations = useMemo(
    () => installations.filter((item) => item.team_id === teamId && !item.deleted_at),
    [installations, teamId],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: teamRows, error: teamsError } = await supabase
        .from("teams").select("id,name").order("created_at", { ascending: true });
      if (teamsError) throw teamsError;
      const loadedTeams = (teamRows ?? []) as Team[];
      const selectedTeamId = teamId && loadedTeams.some((team) => team.id === teamId)
        ? teamId
        : loadedTeams[0]?.id ?? "";
      setTeams(loadedTeams);
      setTeamId(selectedTeamId);
      if (!selectedTeamId) {
        setInstallations([]);
        setRepositories([]);
        return;
      }

      const [{ data: installationRows, error: installationError }, { data: repositoryRows, error: repositoryError }] = await Promise.all([
        supabase.from("github_installations")
          .select("installation_id,team_id,account_login,account_type,repository_selection,suspended_at,deleted_at,last_reconciled_at")
          .eq("team_id", selectedTeamId),
        supabase.from("team_repositories")
          .select("github_repo_id,full_name,default_branch,is_private,active,last_synced_at")
          .eq("team_id", selectedTeamId)
          .order("full_name", { ascending: true }),
      ]);
      if (installationError) throw installationError;
      if (repositoryError) throw repositoryError;
      setInstallations((installationRows ?? []) as Installation[]);
      setRepositories((repositoryRows ?? []) as Repository[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load GitHub integrations.");
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

  async function connectGithub() {
    if (!teamId) return;
    setConnecting(true);
    setError("");
    setNotice("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("create-github-installation-link", {
        body: { team_id: teamId },
      });
      if (requestError) throw requestError;
      if (!data?.install_url || typeof data.install_url !== "string" || !data.install_url.startsWith("https://github.com/apps/")) {
        throw new Error("The server did not return a valid GitHub App installation URL.");
      }
      window.location.assign(data.install_url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to start GitHub App installation.");
      setConnecting(false);
    }
  }

  async function syncInstallation(installationId: number) {
    setSyncing(installationId);
    setError("");
    setNotice("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("sync-github-installation", {
        body: { team_id: teamId, installation_id: installationId },
      });
      if (requestError) throw requestError;
      if (!data?.ok) throw new Error("The repository sync did not complete.");
      setNotice("Synced " + String(data.repository_count ?? 0) + " repositories from GitHub.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to sync repositories.");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <main className="platform-page platform-wide">
      <header className="platform-header">
        <div>
          <p className="platform-eyebrow">DEVOPS INSIGHT AI / INTEGRATIONS</p>
          <h1>GitHub App</h1>
          <p>Connect a GitHub installation to a workspace and sync the repositories it grants access to.</p>
        </div>
        <Link to="/dashboard">Back to workspace</Link>
      </header>

      <section className="platform-card">
        <label htmlFor="integration-team">Workspace</label>
        <select id="integration-team" value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={loading || teams.length === 0}>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <div className="platform-actions">
          <button type="button" onClick={() => void connectGithub()} disabled={!teamId || connecting || loading}>
            <GitBranch size={16} />
            {connecting ? "Opening GitHub…" : "Connect GitHub App"}
          </button>
          <button type="button" className="platform-secondary" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
        {error && <p className="platform-error" role="alert">{error}</p>}
        {notice && <p className="platform-success" role="status">{notice}</p>}
      </section>

      <section className="platform-card">
        <h2>Installations</h2>
        {loading ? <p role="status">Loading installations…</p> : activeInstallations.length === 0 ? (
          <p className="platform-muted">No GitHub App installation is connected to this workspace yet.</p>
        ) : activeInstallations.map((installation) => (
          <article className="platform-list-row" key={installation.installation_id}>
            <div>
              <strong>{installation.account_login}</strong>
              <p>{installation.account_type} · {installation.repository_selection} repositories</p>
              {installation.suspended_at && <p className="platform-error">Installation is suspended.</p>}
              <small>Last synced: {installation.last_reconciled_at ? new Date(installation.last_reconciled_at).toLocaleString() : "Not yet synced"}</small>
            </div>
            <button type="button" onClick={() => void syncInstallation(installation.installation_id)} disabled={syncing === installation.installation_id || Boolean(installation.suspended_at)}>
              <RefreshCw size={15} /> {syncing === installation.installation_id ? "Syncing…" : "Sync repositories"}
            </button>
          </article>
        ))}
      </section>

      <section className="platform-card">
        <h2><GitBranch size={17} /> Repositories</h2>
        {repositories.length === 0 ? <p className="platform-muted">No repository records for this workspace. Sync an installation to load accessible repositories.</p> : (
          <div className="platform-table-wrap">
            <table>
              <thead><tr><th>Repository</th><th>Default branch</th><th>Visibility</th><th>Status</th></tr></thead>
              <tbody>{repositories.map((repository) => (
                <tr key={repository.github_repo_id}>
                  <td>{repository.full_name}</td>
                  <td>{repository.default_branch ?? "—"}</td>
                  <td>{repository.is_private ? "Private" : "Public"}</td>
                  <td>{repository.active ? "Active" : "Archived / inactive"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
