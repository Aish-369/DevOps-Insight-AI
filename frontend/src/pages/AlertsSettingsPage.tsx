import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "../lib/supabase";
import "./PlatformPages.css";

type Team = { id: string; name: string; role: string };
type Channel = { id: string; channel_type: "email" | "telegram"; target: string; verified_at: string | null };
type Alert = { id: string; kind: string; status: string; created_at: string; github_run_id: number };

export default function AlertsSettingsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [channelType, setChannelType] = useState<"email" | "telegram">("email");
  const [target, setTarget] = useState("");
  const [verificationChannelId, setVerificationChannelId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [branchesText, setBranchesText] = useState("");
  const [notifyRecovered, setNotifyRecovered] = useState(true);
  const [skipFlaky, setSkipFlaky] = useState(true);
  const [dailyCap, setDailyCap] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedTeam = teams.find((team) => team.id === teamId);
  const canManage = selectedTeam?.role === "owner" || selectedTeam?.role === "admin";

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) throw new Error("Your sign-in session has expired.");
      const [{ data: teamRows, error: teamsError }, { data: membershipRows, error: memberError }] = await Promise.all([
        supabase.from("teams").select("id,name").order("created_at", { ascending: true }),
        supabase.from("team_members").select("team_id,role").eq("user_id", authData.user.id),
      ]);
      if (teamsError) throw teamsError;
      if (memberError) throw memberError;
      const roles = new Map((membershipRows ?? []).map((row) => [row.team_id, String(row.role)]));
      const loaded = (teamRows ?? []).map((team) => ({ id: team.id, name: team.name, role: roles.get(team.id) ?? "member" }));
      const selected = teamId && loaded.some((team) => team.id === teamId) ? teamId : loaded[0]?.id ?? "";
      setTeams(loaded);
      setTeamId(selected);
      if (!selected) { setChannels([]); setAlerts([]); return; }

      const [{ data: channelRows, error: channelError }, { data: rule, error: ruleError }, { data: alertRows, error: alertsError }] = await Promise.all([
        supabase.from("alert_channels").select("id,channel_type,target,verified_at").eq("team_id", selected),
        supabase.from("alert_rules").select("branches,notify_recovered,skip_flaky,daily_ai_cap").eq("team_id", selected).maybeSingle(),
        supabase.from("alerts_sent").select("id,kind,status,created_at,github_run_id").eq("team_id", selected).order("created_at", { ascending: false }).limit(30),
      ]);
      if (channelError) throw channelError;
      if (ruleError) throw ruleError;
      if (alertsError) throw alertsError;
      setChannels((channelRows ?? []) as Channel[]);
      setAlerts((alertRows ?? []) as Alert[]);
      if (rule) {
        setBranchesText(Array.isArray(rule.branches) ? rule.branches.join(", ") : "");
        setNotifyRecovered(Boolean(rule.notify_recovered));
        setSkipFlaky(rule.skip_flaky !== false);
        setDailyCap(Number(rule.daily_ai_cap ?? 30));
      } else {
        setBranchesText("");
        setNotifyRecovered(true);
        setSkipFlaky(true);
        setDailyCap(30);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load alert settings.");
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

  async function requestVerification() {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("verify-alert-channel", {
        body: { team_id: teamId, channel_type: channelType, target: target.trim() },
      });
      if (requestError) throw requestError;
      if (!data?.ok || !data.channel_id) throw new Error("Alert channel verification could not be started.");
      setVerificationChannelId(data.channel_id);
      setNotice("Verification code sent. It expires in 10 minutes.");
      setTarget("");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to send verification code.");
    } finally { setSaving(false); }
  }

  async function verifyChannel() {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("verify-alert-channel", {
        body: { team_id: teamId, channel_id: verificationChannelId, code: verificationCode },
      });
      if (requestError) throw requestError;
      if (!data?.ok || !data.verified) throw new Error("Alert destination was not verified.");
      setVerificationChannelId("");
      setVerificationCode("");
      setNotice("Alert destination verified.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to verify this destination.");
    } finally { setSaving(false); }
  }

  async function saveRules() {
    if (!canManage) return;
    setSaving(true); setError(""); setNotice("");
    const branches = branchesText.split(",").map((branch) => branch.trim()).filter(Boolean).slice(0, 100);
    if (!Number.isInteger(dailyCap) || dailyCap < 0 || dailyCap > 500) {
      setError("Daily failure-analysis limit must be between 0 and 500.");
      setSaving(false);
      return;
    }
    try {
      const ruleValues = {
        branches,
        notify_recovered: notifyRecovered,
        skip_flaky: skipFlaky,
        daily_ai_cap: dailyCap,
        updated_at: new Date().toISOString(),
      };
      const { data: existingRule, error: lookupError } = await supabase
        .from("alert_rules").select("team_id").eq("team_id", teamId).maybeSingle();
      if (lookupError) throw lookupError;
      const saveResult = existingRule
        ? await supabase.from("alert_rules").update(ruleValues).eq("team_id", teamId)
        : await supabase.from("alert_rules").insert({ ...ruleValues, team_id: teamId });
      if (saveResult.error) throw saveResult.error;
      setNotice("Alert rules saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save alert rules.");
    } finally { setSaving(false); }
  }

  async function dispatchNow() {
    setSaving(true); setError(""); setNotice("");
    try {
      const { data, error: requestError } = await supabase.functions.invoke("dispatch-alerts", { body: { team_id: teamId } });
      if (requestError) throw requestError;
      setNotice("Dispatch finished: " + String(data?.sent ?? 0) + " sent, " + String(data?.failed ?? 0) + " failed.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to dispatch alerts.");
    } finally { setSaving(false); }
  }

  return (
    <main className="platform-page platform-wide">
      <header className="platform-header">
        <div>
          <p className="platform-eyebrow">DEVOPS INSIGHT AI / NOTIFICATIONS</p>
          <h1>Alert settings</h1>
          <p>Verify destinations, configure branch rules and review queued notification deliveries.</p>
        </div>
        <Link to="/dashboard">Back to workspace</Link>
      </header>
      <section className="platform-card">
        <label htmlFor="alert-team">Workspace</label>
        <select id="alert-team" value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={loading || teams.length === 0}>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        {!canManage && <p className="platform-muted">You can view team alert history. Only workspace owners and admins can configure channels and rules.</p>}
        {error && <p className="platform-error" role="alert">{error}</p>}
        {notice && <p className="platform-success" role="status">{notice}</p>}
      </section>
      {canManage && (
        <>
          <section className="platform-card">
            <h2><Bell size={18} /> Verify a notification destination</h2>
            <label htmlFor="alert-channel-type">Channel</label>
            <select id="alert-channel-type" value={channelType} onChange={(event) => setChannelType(event.target.value as "email" | "telegram")}>
              <option value="email">Email</option><option value="telegram">Telegram chat ID</option>
            </select>
            <label htmlFor="alert-target">{channelType === "email" ? "Email address" : "Telegram chat ID"}</label>
            <input id="alert-target" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={channelType === "email" ? "alerts@example.com" : "123456789"} />
            <button type="button" onClick={() => void requestVerification()} disabled={saving || !target.trim()}>Send verification code</button>
            {verificationChannelId && (
              <div className="platform-inline-form">
                <label htmlFor="alert-code">6-digit verification code</label>
                <input id="alert-code" inputMode="numeric" maxLength={6} value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))} />
                <button type="button" onClick={() => void verifyChannel()} disabled={saving || verificationCode.length !== 6}>Verify destination</button>
              </div>
            )}
            <h3>Saved channels</h3>
            {channels.length === 0 ? <p className="platform-muted">No visible channels have been added to this workspace.</p> : channels.map((channel) => (
              <div className="platform-list-row" key={channel.id}>
                <div><strong>{channel.target}</strong><p>{channel.channel_type} · {channel.verified_at ? "Verified" : "Pending verification"}</p></div>
                <span className={"platform-status " + (channel.verified_at ? "platform-status-success" : "platform-status-neutral")}>{channel.verified_at ? "Active" : "Pending"}</span>
              </div>
            ))}
          </section>
          <section className="platform-card">
            <h2>Alert rules</h2>
            <label htmlFor="alert-branches">Branches (comma separated; blank means all branches)</label>
            <input id="alert-branches" value={branchesText} onChange={(event) => setBranchesText(event.target.value)} placeholder="main, release/*" />
            <label className="platform-checkbox"><input type="checkbox" checked={notifyRecovered} onChange={(event) => setNotifyRecovered(event.target.checked)} /> Notify when a workflow recovers</label>
            <label className="platform-checkbox"><input type="checkbox" checked={skipFlaky} onChange={(event) => setSkipFlaky(event.target.checked)} /> Suppress failure alerts when a later retry succeeds (10-minute grace period)</label>
            <label htmlFor="daily-ai-cap">Daily failure-analysis limit per team</label>
            <input id="daily-ai-cap" type="number" min={0} max={500} value={dailyCap} onChange={(event) => setDailyCap(Number(event.target.value))} />
            <button type="button" onClick={() => void saveRules()} disabled={saving}>Save rules</button>
          </section>
          <section className="platform-card">
            <h2>Notification delivery</h2>
            <p>Dispatch queued alerts manually while a scheduler is not configured. If a delivery outcome is unknown, check the provider before attempting any manual resend.</p>
            <button type="button" onClick={() => void dispatchNow()} disabled={saving}><Bell size={16} /> Dispatch pending alerts</button>
          </section>
        </>
      )}
      <section className="platform-card">
        <h2>Recent alerts</h2>
        {loading ? <p role="status">Loading alert history…</p> : alerts.length === 0 ? <p className="platform-muted">No alerts recorded for this workspace yet.</p> : alerts.map((alert) => (
          <div className="platform-list-row" key={alert.id}>
            <div><strong>{alert.kind} workflow alert</strong><p>Run #{alert.github_run_id} · {new Date(alert.created_at).toLocaleString()}</p></div>
            <span className="platform-status platform-status-neutral">{alert.status === "delivery_unknown" ? "Delivery unknown — check provider" : alert.status}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
