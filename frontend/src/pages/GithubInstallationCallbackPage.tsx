import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "./PlatformPages.css";

export default function GithubInstallationCallbackPage() {
  const [params] = useSearchParams();
  const requestRef = useRef<Promise<{ status: string; message: string }> | null>(null);
  const [status, setStatus] = useState("processing");
  const [message, setMessage] = useState("Verifying the GitHub installation…");

  const installationId = Number(params.get("installation_id"));
  const state = params.get("state") ?? "";
  const setupAction = params.get("setup_action");

  useEffect(() => {
    let active = true;
    async function complete(): Promise<{ status: string; message: string }> {
      if (setupAction === "request") {
        throw new Error("The GitHub installation request was sent to the organization owner. Complete approval in GitHub, then retry the connection.");
      }
      if (setupAction === "cancel") {
        throw new Error("The GitHub App installation was cancelled.");
      }
      if (!Number.isSafeInteger(installationId) || installationId <= 0 || !/^[0-9a-f]{64}$/i.test(state)) {
        throw new Error("GitHub did not return a valid installation callback. Start the connection again.");
      }

      const { data, error } = await supabase.functions.invoke("complete-github-installation", {
        body: { installation_id: installationId, state },
      });
      if (error) throw error;
      if (!data?.ok || !data.team_id) {
        throw new Error("GitHub installation could not be connected.");
      }

      const syncResult = await supabase.functions.invoke("sync-github-installation", {
        body: { team_id: data.team_id, installation_id: installationId },
      });
      if (syncResult.error) {
        return {
          status: "partial",
          message: "GitHub is connected, but repository sync did not finish. Open Integrations and retry the sync.",
        };
      }
      return {
        status: "success",
        message: "GitHub App connected and " + String(syncResult.data?.repository_count ?? 0) + " repositories synced.",
      };
    }

    // React StrictMode replays effects in development; reuse a single promise
    // so the one-time GitHub OAuth state is not submitted twice from this tab.
    if (!requestRef.current) requestRef.current = complete();
    void requestRef.current.then((result) => {
      if (!active) return;
      setStatus(result.status);
      setMessage(result.message);
    }).catch((error: unknown) => {
      if (!active) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "GitHub installation could not be completed.");
    });

    return () => {
      active = false;
    };
  }, [installationId, state, setupAction]);

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
