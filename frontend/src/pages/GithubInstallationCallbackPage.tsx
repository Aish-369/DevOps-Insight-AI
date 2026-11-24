import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./PlatformPages.css";

export default function GithubInstallationCallbackPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState("processing");
  const [message, setMessage] = useState("Verifying the GitHub installation…");

  useEffect(() => {
    let active = true;
    async function complete() {
      const installationId = Number(params.get("installation_id"));
      const state = params.get("state") ?? "";
      const setupAction = params.get("setup_action");
      if (setupAction === "request") throw new Error("The GitHub installation request was sent to the organization owner. Complete approval in GitHub, then retry the connection.");
      if (setupAction === "cancel") throw new Error("The GitHub App installation was cancelled.");
      if (!Number.isSafeInteger(installationId) || installationId <= 0 || !/^[0-9a-f]{64}$/i.test(state)) {
        throw new Error("GitHub did not return a valid installation callback. Start the connection again.");
      }

      const { data, error } = await supabase.functions.invoke("complete-github-installation", {
        body: { installation_id: installationId, state },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("GitHub installation could not be connected.");

      const syncResult = await supabase.functions.invoke("sync-github-installation", {
        body: { team_id: data.team_id, installation_id: installationId },
      });
      if (syncResult.error) {
        if (active) {
          setStatus("partial");
          setMessage("GitHub is connected, but repository sync did not finish. Open Integrations and retry the sync.");
        }
        return;
      }
      if (active) {
        setStatus("success");
        setMessage("GitHub App connected and " + String(syncResult.data?.repository_count ?? 0) + " repositories synced.");
      }
    }
    void complete().catch((error: unknown) => {
      if (active) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "GitHub installation could not be completed.");
      }
    });
    return () => { active = false; };
  }, [params]);

  return (
    <main className="platform-page">
      <section className="platform-card">
        <p className="platform-eyebrow">DEVOPS INSIGHT AI / GITHUB CALLBACK</p>
        <h1>{status === "success" ? "GitHub connected" : status === "processing" ? "Connecting GitHub…" : "GitHub connection"}</h1>
        {status === "processing" ? <p role="status">{message}</p> : <p className={status === "success" ? "platform-success" : "platform-error"} role={status === "error" ? "alert" : "status"}>{message}</p>}
        {status !== "processing" && <Link className="platform-primary-link" to="/integrations">Open integrations</Link>}
      </section>
    </main>
  );
}
