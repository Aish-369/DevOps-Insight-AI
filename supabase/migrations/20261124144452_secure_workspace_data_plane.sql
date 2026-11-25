BEGIN;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC globally by default.
-- A schema-scoped REVOKE cannot override a global default grant, so revoke it
-- globally for the migration owner before tightening the per-schema defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Secure future objects created by the migration owner in the exposed schema.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Remove unnecessary broad grants on existing application tables.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- RLS helper functions are kept outside the exposed PostgREST schema.
CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.is_team_member(check_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = check_team_id
      AND tm.user_id = (SELECT auth.uid())
  );
$function$;

CREATE OR REPLACE FUNCTION private.is_team_admin(check_team_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.team_id = check_team_id
      AND tm.user_id = (SELECT auth.uid())
      AND tm.role IN ('owner', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION private.add_team_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (team_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.is_team_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_team_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.add_team_owner_membership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_team_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_team_admin(uuid) TO authenticated;

DROP TRIGGER IF EXISTS on_team_created_add_owner ON public.teams;
CREATE TRIGGER on_team_created_add_owner
AFTER INSERT ON public.teams
FOR EACH ROW
EXECUTE FUNCTION private.add_team_owner_membership();

DROP POLICY IF EXISTS "Team members can view workspace" ON public.teams;
DROP POLICY IF EXISTS "Workspace owners can delete workspace" ON public.teams;
DROP POLICY IF EXISTS "Team admins can update workspace" ON public.teams;
DROP POLICY IF EXISTS "Users can create owned workspaces" ON public.teams;
CREATE POLICY teams_select_member ON public.teams
  FOR SELECT TO authenticated USING (private.is_team_member(id));
CREATE POLICY teams_insert_owner ON public.teams
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY teams_update_admin ON public.teams
  FOR UPDATE TO authenticated
  USING (private.is_team_admin(id))
  WITH CHECK (private.is_team_admin(id));
CREATE POLICY teams_delete_owner ON public.teams
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Team members can view membership" ON public.team_members;
CREATE POLICY team_members_select_member ON public.team_members
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));

DROP POLICY IF EXISTS "Team admins can create invitations" ON public.team_invitations;
DROP POLICY IF EXISTS "Team admins can view invitations" ON public.team_invitations;
DROP POLICY IF EXISTS "Team admins can delete invitations" ON public.team_invitations;
ALTER TABLE public.team_invitations
  ADD COLUMN token_hash text,
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN revoked_at timestamptz;
CREATE UNIQUE INDEX team_invitations_token_hash_uidx
  ON public.team_invitations(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX team_invitations_invited_by_idx
  ON public.team_invitations(invited_by);
CREATE POLICY team_invitations_select_admin ON public.team_invitations
  FOR SELECT TO authenticated USING (private.is_team_admin(team_id));

DROP POLICY IF EXISTS "Team members can create projects" ON public.team_projects;
DROP POLICY IF EXISTS "Team admins can update projects" ON public.team_projects;
DROP POLICY IF EXISTS "Team admins can delete projects" ON public.team_projects;
DROP POLICY IF EXISTS "Team members can view projects" ON public.team_projects;
CREATE POLICY team_projects_select_member ON public.team_projects
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY team_projects_insert_member ON public.team_projects
  FOR INSERT TO authenticated
  WITH CHECK (private.is_team_member(team_id) AND created_by = (SELECT auth.uid()));
CREATE POLICY team_projects_update_admin ON public.team_projects
  FOR UPDATE TO authenticated
  USING (private.is_team_admin(team_id))
  WITH CHECK (private.is_team_admin(team_id));
CREATE POLICY team_projects_delete_admin ON public.team_projects
  FOR DELETE TO authenticated USING (private.is_team_admin(team_id));

-- Existing duplicate FK was confirmed by catalog inspection. Keep profiles_id_fkey.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_id_auth_users_fkey;

-- Cover the three foreign keys reported by Supabase performance advisors.
CREATE INDEX IF NOT EXISTS teams_owner_id_idx ON public.teams(owner_id);
CREATE INDEX IF NOT EXISTS team_projects_created_by_idx ON public.team_projects(created_by);


-- Serialize owner demotions/removals so a team cannot lose its last owner.
CREATE OR REPLACE FUNCTION private.prevent_last_team_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_team_id uuid;
  remaining_owners integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Team membership identity cannot be changed';
    END IF;
    target_team_id := OLD.team_id;
    IF OLD.role <> 'owner' OR NEW.role = 'owner' THEN
      RETURN NEW;
    END IF;
  ELSE
    target_team_id := OLD.team_id;
    IF OLD.role <> 'owner' THEN
      RETURN OLD;
    END IF;
  END IF;

  PERFORM 1 FROM public.teams t WHERE t.id = target_team_id FOR UPDATE;
  -- A workspace deletion cascades to memberships. Its parent row is already
  -- being deleted, so do not block the intentional cascade on the owner guard.
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT count(*) INTO remaining_owners
  FROM public.team_members tm
  WHERE tm.team_id = target_team_id
    AND tm.role = 'owner'
    AND tm.user_id <> OLD.user_id;

  IF remaining_owners = 0 THEN
    RAISE EXCEPTION 'A team must retain at least one owner';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.prevent_last_team_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS team_members_prevent_last_owner ON public.team_members;
CREATE TRIGGER team_members_prevent_last_owner
BEFORE UPDATE OR DELETE ON public.team_members
FOR EACH ROW
EXECUTE FUNCTION private.prevent_last_team_owner();

-- GitHub App installation is mapped to one team at a time.
CREATE TABLE public.github_installations (
  installation_id bigint PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  account_login text NOT NULL,
  account_type text NOT NULL,
  repository_selection text NOT NULL DEFAULT 'selected',
  suspended_at timestamptz,
  deleted_at timestamptz,
  last_reconciled_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, team_id)
);
CREATE INDEX github_installations_team_idx ON public.github_installations(team_id);

CREATE TABLE public.team_repositories (
  github_repo_id bigint PRIMARY KEY,
  team_id uuid NOT NULL,
  installation_id bigint NOT NULL,
  full_name text NOT NULL,
  default_branch text,
  is_private boolean NOT NULL DEFAULT false,
  archived boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_repo_id, team_id),
  UNIQUE (team_id, full_name),
  FOREIGN KEY (installation_id, team_id)
    REFERENCES public.github_installations(installation_id, team_id) ON DELETE CASCADE
);
CREATE INDEX team_repositories_team_idx ON public.team_repositories(team_id);
CREATE INDEX team_repositories_installation_idx ON public.team_repositories(installation_id, team_id);

CREATE TABLE public.workflow_runs (
  github_run_id bigint PRIMARY KEY,
  team_id uuid NOT NULL,
  github_repo_id bigint NOT NULL,
  workflow_name text NOT NULL,
  run_number bigint NOT NULL,
  run_attempt integer NOT NULL DEFAULT 1 CHECK (run_attempt > 0),
  head_branch text,
  head_sha text,
  event text,
  status text,
  conclusion text,
  actor_login text,
  html_url text,
  run_started_at timestamptz,
  completed_at timestamptz,
  github_updated_at timestamptz,
  is_flaky boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_run_id, team_id),
  FOREIGN KEY (github_repo_id, team_id)
    REFERENCES public.team_repositories(github_repo_id, team_id) ON DELETE CASCADE
);
CREATE INDEX workflow_runs_team_started_idx
  ON public.workflow_runs(team_id, run_started_at DESC);
CREATE INDEX workflow_runs_repo_started_idx
  ON public.workflow_runs(github_repo_id, team_id, run_started_at DESC);

CREATE TABLE public.workflow_jobs (
  github_job_id bigint PRIMARY KEY,
  team_id uuid NOT NULL,
  github_run_id bigint NOT NULL,
  name text NOT NULL,
  status text,
  conclusion text,
  failed_step_name text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (github_job_id, team_id),
  FOREIGN KEY (github_run_id, team_id)
    REFERENCES public.workflow_runs(github_run_id, team_id) ON DELETE CASCADE
);
CREATE INDEX workflow_jobs_run_idx ON public.workflow_jobs(github_run_id, team_id);

CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  github_repo_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('push', 'pr_opened', 'pr_merged')),
  title text,
  actor_login text,
  url text,
  occurred_at timestamptz NOT NULL,
  delivery_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (github_repo_id, team_id)
    REFERENCES public.team_repositories(github_repo_id, team_id) ON DELETE CASCADE
);
CREATE INDEX activity_events_team_occurred_idx
  ON public.activity_events(team_id, occurred_at DESC);
CREATE UNIQUE INDEX activity_events_delivery_kind_uidx
  ON public.activity_events(delivery_id, kind);

-- Raw GitHub webhook bodies are deliberately not persisted.
CREATE TABLE public.webhook_events (
  delivery_id text PRIMARY KEY,
  event_type text NOT NULL,
  action text,
  installation_id bigint,
  github_repo_id bigint,
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed', 'unmatched')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  dead boolean NOT NULL DEFAULT false
);
CREATE INDEX webhook_events_status_received_idx
  ON public.webhook_events(status, received_at);

CREATE TABLE public.failure_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  github_run_id bigint NOT NULL,
  github_job_id bigint,
  signature text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
  category text,
  cause text,
  fix_steps jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(fix_steps) = 'array'),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence) = 'array'),
  confidence text CHECK (confidence IN ('high', 'medium', 'low')),
  model text,
  prompt_version text,
  tokens_in integer CHECK (tokens_in IS NULL OR tokens_in >= 0),
  tokens_out integer CHECK (tokens_out IS NULL OR tokens_out >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id, team_id),
  FOREIGN KEY (github_run_id, team_id)
    REFERENCES public.workflow_runs(github_run_id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (github_job_id, team_id)
    REFERENCES public.workflow_jobs(github_job_id, team_id) ON DELETE SET NULL (github_job_id)
);
CREATE INDEX failure_analyses_team_signature_created_idx
  ON public.failure_analyses(team_id, signature, created_at DESC);
CREATE INDEX failure_analyses_run_idx
  ON public.failure_analyses(github_run_id, team_id);

CREATE TABLE public.analysis_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  analysis_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  helpful boolean NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, user_id),
  FOREIGN KEY (analysis_id, team_id)
    REFERENCES public.failure_analyses(id, team_id) ON DELETE CASCADE
);
CREATE INDEX analysis_feedback_team_idx ON public.analysis_feedback(team_id);

CREATE TABLE public.alert_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('email', 'telegram')),
  target text NOT NULL,
  verified_at timestamptz,
  verification_code_hash text,
  verification_expires_at timestamptz,
  verification_attempts integer NOT NULL DEFAULT 0 CHECK (verification_attempts >= 0),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, team_id),
  CHECK (length(trim(target)) > 0)
);
CREATE UNIQUE INDEX alert_channels_team_kind_target_uidx
  ON public.alert_channels(team_id, channel_type, lower(target));
CREATE INDEX alert_channels_team_idx ON public.alert_channels(team_id);

CREATE TABLE public.alert_rules (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  branches text[] NOT NULL DEFAULT ARRAY[]::text[],
  notify_recovered boolean NOT NULL DEFAULT true,
  skip_flaky boolean NOT NULL DEFAULT true,
  daily_ai_cap integer NOT NULL DEFAULT 30 CHECK (daily_ai_cap >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.alerts_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  github_run_id bigint NOT NULL,
  kind text NOT NULL CHECK (kind IN ('failure', 'recovered')),
  dedupe_key text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  attempted_at timestamptz,
  sent_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, dedupe_key),
  FOREIGN KEY (channel_id, team_id)
    REFERENCES public.alert_channels(id, team_id) ON DELETE CASCADE,
  FOREIGN KEY (github_run_id, team_id)
    REFERENCES public.workflow_runs(github_run_id, team_id) ON DELETE CASCADE
);
CREATE INDEX alerts_sent_team_created_idx ON public.alerts_sent(team_id, created_at DESC);

CREATE TABLE public.team_ai_usage (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  usage_day date NOT NULL DEFAULT current_date,
  analyses_used integer NOT NULL DEFAULT 0 CHECK (analyses_used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, usage_day)
);
ALTER TABLE public.team_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON public.team_ai_usage FROM anon, authenticated;
GRANT ALL PRIVILEGES ON public.team_ai_usage TO service_role;

CREATE OR REPLACE FUNCTION public.claim_team_ai_analysis(p_team_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  configured_cap integer;
  claimed boolean;
BEGIN
  SELECT ar.daily_ai_cap INTO configured_cap
  FROM public.alert_rules ar
  WHERE ar.team_id = p_team_id;

  IF NOT FOUND THEN configured_cap := 30; END IF;
  IF configured_cap <= 0 THEN RETURN false; END IF;

  INSERT INTO public.team_ai_usage(team_id, usage_day, analyses_used)
  VALUES (p_team_id, current_date, 0)
  ON CONFLICT (team_id, usage_day) DO NOTHING;

  UPDATE public.team_ai_usage
  SET analyses_used = analyses_used + 1,
      updated_at = now()
  WHERE team_id = p_team_id
    AND usage_day = current_date
    AND analyses_used < configured_cap
  RETURNING true INTO claimed;

  RETURN COALESCE(claimed, false);
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_team_ai_analysis(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_team_ai_analysis(uuid) TO service_role;

CREATE TABLE public.team_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_audit_events_team_created_idx
  ON public.team_audit_events(team_id, created_at DESC);

CREATE TABLE public.github_installation_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_installation_states_expiry_idx
  ON public.github_installation_states(expires_at)
  WHERE consumed_at IS NULL;

-- All application tables remain RLS-protected.
ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failure_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_installation_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY github_installations_select_member ON public.github_installations
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY team_repositories_select_member ON public.team_repositories
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY workflow_runs_select_member ON public.workflow_runs
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY workflow_jobs_select_member ON public.workflow_jobs
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY activity_events_select_member ON public.activity_events
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY failure_analyses_select_member ON public.failure_analyses
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));

CREATE POLICY analysis_feedback_select_member ON public.analysis_feedback
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY analysis_feedback_insert_own ON public.analysis_feedback
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND private.is_team_member(team_id)
    AND EXISTS (
      SELECT 1 FROM public.failure_analyses fa
      WHERE fa.id = analysis_id AND fa.team_id = analysis_feedback.team_id
    )
  );
CREATE POLICY analysis_feedback_update_own ON public.analysis_feedback
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.is_team_member(team_id))
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.is_team_member(team_id));
CREATE POLICY analysis_feedback_delete_own ON public.analysis_feedback
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.is_team_member(team_id));

CREATE POLICY alert_channels_select_admin ON public.alert_channels
  FOR SELECT TO authenticated USING (private.is_team_admin(team_id));
CREATE POLICY alert_channels_insert_admin ON public.alert_channels
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_team_admin(team_id)
    AND created_by = (SELECT auth.uid())
    AND verified_at IS NULL
    AND verification_code_hash IS NULL
  );
CREATE POLICY alert_channels_update_admin ON public.alert_channels
  FOR UPDATE TO authenticated
  USING (private.is_team_admin(team_id) AND verified_at IS NULL)
  WITH CHECK (private.is_team_admin(team_id) AND verified_at IS NULL);
CREATE POLICY alert_channels_delete_admin ON public.alert_channels
  FOR DELETE TO authenticated USING (private.is_team_admin(team_id));

CREATE POLICY alert_rules_select_member ON public.alert_rules
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY alert_rules_insert_admin ON public.alert_rules
  FOR INSERT TO authenticated WITH CHECK (private.is_team_admin(team_id));
CREATE POLICY alert_rules_update_admin ON public.alert_rules
  FOR UPDATE TO authenticated
  USING (private.is_team_admin(team_id))
  WITH CHECK (private.is_team_admin(team_id));
CREATE POLICY alert_rules_delete_admin ON public.alert_rules
  FOR DELETE TO authenticated USING (private.is_team_admin(team_id));

CREATE POLICY alerts_sent_select_member ON public.alerts_sent
  FOR SELECT TO authenticated USING (private.is_team_member(team_id));
CREATE POLICY team_audit_events_select_admin ON public.team_audit_events
  FOR SELECT TO authenticated USING (private.is_team_admin(team_id));

-- Keep all new write paths server-controlled except user feedback and admin-owned
-- notification configuration. GitHub/webhook/AI/dispatch functions use service_role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON public.profiles, public.teams, public.team_members,
  public.team_invitations, public.team_projects,
  public.github_installations, public.team_repositories,
  public.workflow_runs, public.workflow_jobs, public.activity_events,
  public.failure_analyses, public.alerts_sent
TO authenticated;
GRANT SELECT, UPDATE (display_name, github_username)
  ON public.profiles TO authenticated;
GRANT INSERT (name, description, owner_id) ON public.teams TO authenticated;
GRANT UPDATE (name, description) ON public.teams TO authenticated;
GRANT DELETE ON public.teams TO authenticated;
GRANT INSERT (team_id, name, repository_url, created_by)
  ON public.team_projects TO authenticated;
GRANT UPDATE (name, repository_url) ON public.team_projects TO authenticated;
GRANT DELETE ON public.team_projects TO authenticated;

GRANT SELECT ON public.analysis_feedback TO authenticated;
GRANT INSERT (team_id, analysis_id, user_id, helpful, note)
  ON public.analysis_feedback TO authenticated;
GRANT UPDATE (helpful, note) ON public.analysis_feedback TO authenticated;
GRANT DELETE ON public.analysis_feedback TO authenticated;
GRANT SELECT ON public.alert_channels TO authenticated;
GRANT INSERT (team_id, channel_type, target, created_by)
  ON public.alert_channels TO authenticated;
GRANT UPDATE (channel_type, target) ON public.alert_channels TO authenticated;
GRANT DELETE ON public.alert_channels TO authenticated;
GRANT SELECT ON public.alert_rules TO authenticated;
GRANT INSERT (team_id, branches, notify_recovered, skip_flaky, daily_ai_cap)
  ON public.alert_rules TO authenticated;
GRANT UPDATE (branches, notify_recovered, skip_flaky, daily_ai_cap)
  ON public.alert_rules TO authenticated;
GRANT DELETE ON public.alert_rules TO authenticated;
GRANT SELECT ON public.team_audit_events TO authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.github_installations,
  public.team_repositories,
  public.workflow_runs,
  public.workflow_jobs,
  public.activity_events,
  public.webhook_events,
  public.failure_analyses,
  public.analysis_feedback,
  public.alert_channels,
  public.alert_rules,
  public.alerts_sent,
  public.team_audit_events,
  public.github_installation_states
TO service_role;

-- The private state and webhook delivery tables are not directly exposed to users.
REVOKE ALL PRIVILEGES ON public.webhook_events, public.github_installation_states
  FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.add_team_owner_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_team_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_team_member(uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.add_team_owner_membership();
DROP FUNCTION public.is_team_admin(uuid);
DROP FUNCTION public.is_team_member(uuid);

COMMIT;
