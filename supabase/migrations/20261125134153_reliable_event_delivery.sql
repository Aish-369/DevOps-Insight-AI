BEGIN;

-- Persist attempt history independently from the latest workflow_runs snapshot.
CREATE TABLE public.workflow_run_attempts (
  github_run_id bigint NOT NULL,
  team_id uuid NOT NULL,
  run_attempt integer NOT NULL CHECK (run_attempt > 0),
  status text,
  conclusion text,
  completed_at timestamptz,
  github_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_run_id, run_attempt),
  UNIQUE (github_run_id, run_attempt, team_id),
  FOREIGN KEY (github_run_id, team_id)
    REFERENCES public.workflow_runs(github_run_id, team_id) ON DELETE CASCADE
);
CREATE INDEX workflow_run_attempts_team_run_idx
  ON public.workflow_run_attempts(team_id, github_run_id, run_attempt DESC);

-- Seed the latest known attempt for runs that existed before this migration.
INSERT INTO public.workflow_run_attempts (
  github_run_id, team_id, run_attempt, status, conclusion,
  completed_at, github_updated_at
)
SELECT
  github_run_id, team_id, run_attempt, status, conclusion,
  completed_at, github_updated_at
FROM public.workflow_runs
ON CONFLICT (github_run_id, run_attempt) DO NOTHING;

CREATE OR REPLACE FUNCTION private.keep_latest_workflow_run_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  incoming_is_flaky boolean := NEW.is_flaky;
BEGIN
  IF NEW.run_attempt < OLD.run_attempt
     OR (
       NEW.run_attempt = OLD.run_attempt
       AND OLD.github_updated_at IS NOT NULL
       AND (
         NEW.github_updated_at IS NULL
         OR NEW.github_updated_at < OLD.github_updated_at
       )
     ) THEN
    NEW := OLD;
    NEW.is_flaky := OLD.is_flaky;
  ELSE
    NEW.is_flaky := incoming_is_flaky;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.keep_latest_workflow_run_snapshot()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workflow_runs_keep_latest_snapshot
BEFORE UPDATE ON public.workflow_runs
FOR EACH ROW EXECUTE FUNCTION private.keep_latest_workflow_run_snapshot();

CREATE OR REPLACE FUNCTION private.keep_latest_workflow_attempt_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.github_updated_at IS NOT NULL
     AND (NEW.github_updated_at IS NULL OR NEW.github_updated_at < OLD.github_updated_at) THEN
    NEW := OLD;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.keep_latest_workflow_attempt_event()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workflow_run_attempts_keep_latest_event
BEFORE UPDATE ON public.workflow_run_attempts
FOR EACH ROW EXECUTE FUNCTION private.keep_latest_workflow_attempt_event();

-- Keep the minimal normalized job fields when GitHub delivers a job before its run.
-- Raw webhook payloads are intentionally not stored.
CREATE TABLE public.pending_workflow_jobs (
  github_job_id bigint PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  github_run_id bigint NOT NULL,
  name text NOT NULL,
  status text,
  conclusion text,
  failed_step_name text,
  started_at timestamptz,
  completed_at timestamptz,
  source_delivery_id text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_workflow_jobs_run_expiry_idx
  ON public.pending_workflow_jobs(team_id, github_run_id, expires_at);

ALTER TABLE public.workflow_run_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_workflow_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY workflow_run_attempts_deny_client
  ON public.workflow_run_attempts FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
CREATE POLICY pending_workflow_jobs_deny_client
  ON public.pending_workflow_jobs FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
REVOKE ALL ON public.workflow_run_attempts, public.pending_workflow_jobs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workflow_run_attempts, public.pending_workflow_jobs
  TO service_role;

-- Shared atomic rate-limit buckets. Keys are SHA-256 hashes, not raw user IDs.
CREATE TABLE private.api_rate_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX api_rate_limits_expiry_idx ON private.api_rate_limits(expires_at);
REVOKE ALL ON private.api_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.api_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count integer;
BEGIN
  IF p_key_hash !~ '^[0-9a-f]{64}$'
     OR p_limit < 1 OR p_limit > 1000
     OR p_window_seconds < 1 OR p_window_seconds > 3600 THEN
    RAISE EXCEPTION 'Invalid rate-limit arguments';
  END IF;

  INSERT INTO private.api_rate_limits AS existing
    (key_hash, window_started_at, request_count, expires_at)
  VALUES
    (p_key_hash, v_now, 1, v_now + make_interval(secs => p_window_seconds))
  ON CONFLICT (key_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN existing.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      THEN v_now ELSE existing.window_started_at END,
    request_count = CASE
      WHEN existing.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      THEN 1 ELSE existing.request_count + 1 END,
    expires_at = CASE
      WHEN existing.window_started_at + make_interval(secs => p_window_seconds) <= v_now
      THEN v_now + make_interval(secs => p_window_seconds)
      ELSE existing.expires_at END
  RETURNING request_count INTO v_count;

  DELETE FROM private.api_rate_limits WHERE expires_at < v_now;
  RETURN v_count <= p_limit;
END;
$function$;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer)
  TO service_role;

-- A provider call is a separate state from a pre-send claim. A stale sending
-- row is ambiguous and must never be automatically re-delivered.
ALTER TABLE public.alerts_sent
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN provider_started_at timestamptz;
ALTER TABLE public.alerts_sent
  DROP CONSTRAINT IF EXISTS alerts_sent_status_check;
ALTER TABLE public.alerts_sent
  ADD CONSTRAINT alerts_sent_status_check
  CHECK (status IN (
    'pending', 'processing', 'sending', 'sent', 'failed', 'skipped',
    'delivery_unknown'
  ));
CREATE INDEX alerts_sent_due_idx
  ON public.alerts_sent(status, available_at, created_at);

-- Rows left in the legacy processing state have an unknowable provider outcome:
-- never resend them automatically after this state-machine upgrade.
UPDATE public.alerts_sent
SET status = 'delivery_unknown',
    failure_code = 'PRE_MIGRATION_DELIVERY_OUTCOME_UNKNOWN'
WHERE status = 'processing';

COMMIT;
