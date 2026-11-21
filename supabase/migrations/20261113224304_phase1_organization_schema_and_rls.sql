BEGIN;

-- Phase 1: Organization schema and Row Level Security
-- Existing teams and profiles are intentionally preserved.

-- 1. Organizations
CREATE TABLE public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(trim(name)) > 0),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    timezone text NOT NULL DEFAULT 'Asia/Kolkata',
    quiet_start time,
    quiet_end time,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'deactivated')),
    deactivated_at timestamptz,
    created_by uuid NOT NULL REFERENCES auth.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (status = 'active' AND deactivated_at IS NULL)
        OR (status = 'deactivated' AND deactivated_at IS NOT NULL)
    )
);

CREATE TABLE public.memberships (
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE public.invites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    email text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    role text NOT NULL DEFAULT 'member' CHECK (role = 'member'),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. GitHub installations and repositories
CREATE TABLE public.github_installations (
    id bigint PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    account_login text NOT NULL,
    account_type text NOT NULL,
    repo_selection text NOT NULL,
    suspended_at timestamptz,
    deleted_at timestamptz,
    last_reconciled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, org_id)
);

CREATE TABLE public.repositories (
    id bigint PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    installation_id bigint NOT NULL,
    full_name text NOT NULL,
    default_branch text,
    is_private boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    backfill_status text NOT NULL DEFAULT 'pending'
        CHECK (backfill_status IN ('pending', 'running', 'done', 'failed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, org_id),
    FOREIGN KEY (installation_id, org_id)
        REFERENCES public.github_installations(id, org_id) ON DELETE RESTRICT
);

-- 3. Workflow data
CREATE TABLE public.workflow_runs (
    id bigint PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    repo_id bigint NOT NULL,
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
    gh_updated_at timestamptz,
    is_flaky boolean NOT NULL DEFAULT false,
    UNIQUE (id, org_id),
    FOREIGN KEY (repo_id, org_id)
        REFERENCES public.repositories(id, org_id) ON DELETE RESTRICT
);

CREATE INDEX workflow_runs_org_repo_started_idx
ON public.workflow_runs (org_id, repo_id, run_started_at DESC);

CREATE TABLE public.workflow_jobs (
    id bigint PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    run_id bigint NOT NULL,
    name text NOT NULL,
    status text,
    conclusion text,
    failed_step_name text,
    started_at timestamptz,
    completed_at timestamptz,
    UNIQUE (id, org_id),
    FOREIGN KEY (run_id, org_id)
        REFERENCES public.workflow_runs(id, org_id) ON DELETE RESTRICT
);

CREATE TABLE public.activity_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    repo_id bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('push', 'pr_opened', 'pr_merged')),
    title text,
    actor_login text,
    url text,
    occurred_at timestamptz NOT NULL,
    delivery_id text,
    FOREIGN KEY (repo_id, org_id)
        REFERENCES public.repositories(id, org_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX activity_events_delivery_kind_uidx
ON public.activity_events (delivery_id, kind)
WHERE delivery_id IS NOT NULL;

-- 4. AI failure analyses and feedback
CREATE TABLE public.failure_analyses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    run_id bigint NOT NULL,
    job_id bigint,
    signature text NOT NULL,
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
    category text,
    cause text,
    fix_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
    evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
    confidence text CHECK (confidence IN ('high', 'medium', 'low')),
    model text,
    tokens_in integer CHECK (tokens_in IS NULL OR tokens_in >= 0),
    tokens_out integer CHECK (tokens_out IS NULL OR tokens_out >= 0),
    reused_from uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, org_id),
    FOREIGN KEY (run_id, org_id)
        REFERENCES public.workflow_runs(id, org_id) ON DELETE RESTRICT,
    FOREIGN KEY (job_id, org_id)
        REFERENCES public.workflow_jobs(id, org_id) ON DELETE RESTRICT,
    FOREIGN KEY (reused_from, org_id)
        REFERENCES public.failure_analyses(id, org_id) ON DELETE RESTRICT
);

CREATE INDEX failure_analyses_org_signature_created_idx
ON public.failure_analyses (org_id, signature, created_at DESC);

CREATE TABLE public.analysis_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    analysis_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    helpful boolean NOT NULL,
    note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (analysis_id, org_id)
        REFERENCES public.failure_analyses(id, org_id) ON DELETE RESTRICT
);

-- 5. Webhook queue: no browser access
CREATE TABLE public.webhook_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id text NOT NULL UNIQUE,
    event text NOT NULL,
    installation_id bigint,
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error text,
    dead boolean NOT NULL DEFAULT false
);

-- 6. Alerts
CREATE TABLE public.alert_channels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    type text NOT NULL CHECK (type IN ('email', 'telegram')),
    target text NOT NULL,
    verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, org_id)
);

CREATE TABLE public.alert_rules (
    org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
    branches text[] NOT NULL DEFAULT ARRAY['default']::text[],
    notify_recovered boolean NOT NULL DEFAULT true,
    skip_flaky boolean NOT NULL DEFAULT true,
    daily_ai_cap integer NOT NULL DEFAULT 30 CHECK (daily_ai_cap >= 0)
);

CREATE TABLE public.alerts_sent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    channel_id uuid NOT NULL,
    run_id bigint NOT NULL,
    kind text NOT NULL CHECK (kind IN ('failure', 'recovered')),
    dedupe_key text NOT NULL,
    status text NOT NULL,
    sent_at timestamptz,
    UNIQUE (channel_id, dedupe_key),
    FOREIGN KEY (channel_id, org_id)
        REFERENCES public.alert_channels(id, org_id) ON DELETE RESTRICT,
    FOREIGN KEY (run_id, org_id)
        REFERENCES public.workflow_runs(id, org_id) ON DELETE RESTRICT
);

-- 7. Clients and reports
CREATE TABLE public.clients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (length(trim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, org_id)
);

CREATE TABLE public.client_repositories (
    client_id uuid NOT NULL,
    repo_id bigint NOT NULL,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    PRIMARY KEY (client_id, repo_id),
    FOREIGN KEY (client_id, org_id)
        REFERENCES public.clients(id, org_id) ON DELETE RESTRICT,
    FOREIGN KEY (repo_id, org_id)
        REFERENCES public.repositories(id, org_id) ON DELETE RESTRICT
);

CREATE TABLE public.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    client_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, org_id),
    CHECK (period_end >= period_start),
    FOREIGN KEY (client_id, org_id)
        REFERENCES public.clients(id, org_id) ON DELETE RESTRICT
);

CREATE TABLE public.report_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    report_id uuid NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (report_id, org_id)
        REFERENCES public.reports(id, org_id) ON DELETE RESTRICT
);

-- 8. Security helper functions
CREATE OR REPLACE FUNCTION public.is_org_member(check_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        JOIN public.organizations o ON o.id = m.org_id
        WHERE m.org_id = check_org_id
          AND m.user_id = (SELECT auth.uid())
          AND o.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(check_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.org_id = check_org_id
          AND m.user_id = (SELECT auth.uid())
          AND m.role = 'owner'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_org_active_owner(check_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.is_org_owner(check_org_id)
       AND EXISTS (
           SELECT 1 FROM public.organizations o
           WHERE o.id = check_org_id AND o.status = 'active'
       );
$$;

-- Automatically add the creator as the first organization owner.
CREATE OR REPLACE FUNCTION public.add_organization_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.memberships (org_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner');
    RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_add_owner_membership
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.add_organization_owner_membership();

CREATE OR REPLACE FUNCTION public.guard_organization_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Organization identity fields are immutable';
    END IF;
    IF NEW.status = 'deactivated' AND OLD.status IS DISTINCT FROM 'deactivated'
       AND NEW.deactivated_at IS NULL THEN
        NEW.deactivated_at := now();
    ELSIF NEW.status = 'active' THEN
        NEW.deactivated_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_guard_update
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.guard_organization_update();

-- Prevent an organization from losing its last owner.
CREATE OR REPLACE FUNCTION public.guard_last_org_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    remaining_owners integer;
    target_org_id uuid;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.org_id IS DISTINCT FROM OLD.org_id
           OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
            RAISE EXCEPTION 'Membership identity cannot be changed; delete and re-invite instead';
        END IF;
        target_org_id := OLD.org_id;
        IF OLD.role <> 'owner' OR NEW.role = 'owner' THEN
            RETURN NEW;
        END IF;
    ELSE
        target_org_id := OLD.org_id;
        IF OLD.role <> 'owner' THEN
            RETURN OLD;
        END IF;
    END IF;

    -- Serialize owner demotions/deletions for this organization.
    PERFORM 1 FROM public.organizations o
    WHERE o.id = target_org_id
    FOR UPDATE;

    SELECT count(*) INTO remaining_owners
    FROM public.memberships m
    WHERE m.org_id = target_org_id
      AND m.role = 'owner'
      AND m.user_id <> OLD.user_id;

    IF remaining_owners = 0 THEN
        RAISE EXCEPTION 'An organization must retain at least one owner';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_guard_last_owner
BEFORE UPDATE OR DELETE ON public.memberships
FOR EACH ROW
EXECUTE FUNCTION public.guard_last_org_owner();

-- 9. Enable RLS on every new table
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.failure_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts_sent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_links ENABLE ROW LEVEL SECURITY;

-- 10. Organization policies
CREATE POLICY organizations_select_member_or_owner
ON public.organizations FOR SELECT TO authenticated
USING (public.is_org_member(id) OR public.is_org_owner(id));

CREATE POLICY organizations_insert_creator
ON public.organizations FOR INSERT TO authenticated
WITH CHECK (created_by = (SELECT auth.uid()));

CREATE POLICY organizations_update_owner
ON public.organizations FOR UPDATE TO authenticated
USING (public.is_org_owner(id))
WITH CHECK (public.is_org_owner(id));

-- Memberships: members can view; owners manage membership.
CREATE POLICY memberships_select_member
ON public.memberships FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY memberships_insert_owner
ON public.memberships FOR INSERT TO authenticated
WITH CHECK (public.is_org_active_owner(org_id));

CREATE POLICY memberships_update_owner
ON public.memberships FOR UPDATE TO authenticated
USING (public.is_org_active_owner(org_id))
WITH CHECK (public.is_org_active_owner(org_id));

CREATE POLICY memberships_delete_owner
ON public.memberships FOR DELETE TO authenticated
USING (public.is_org_active_owner(org_id));

-- Invitations: owner only.
CREATE POLICY invites_owner_all
ON public.invites FOR ALL TO authenticated
USING (public.is_org_active_owner(org_id))
WITH CHECK (public.is_org_active_owner(org_id));

-- Read-only organization data for active members.
CREATE POLICY github_installations_select_member
ON public.github_installations FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY repositories_select_member
ON public.repositories FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY workflow_runs_select_member
ON public.workflow_runs FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY workflow_jobs_select_member
ON public.workflow_jobs FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY activity_events_select_member
ON public.activity_events FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY failure_analyses_select_member
ON public.failure_analyses FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY alerts_sent_select_member
ON public.alerts_sent FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY reports_select_member
ON public.reports FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

-- Member-managed resources.
CREATE POLICY analysis_feedback_select_member
ON public.analysis_feedback FOR SELECT TO authenticated
USING (public.is_org_member(org_id));

CREATE POLICY analysis_feedback_insert_own
ON public.analysis_feedback FOR INSERT TO authenticated
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.is_org_member(org_id)
    AND EXISTS (
        SELECT 1 FROM public.failure_analyses a
        WHERE a.id = analysis_feedback.analysis_id
          AND a.org_id = analysis_feedback.org_id
    )
);

CREATE POLICY analysis_feedback_update_own
ON public.analysis_feedback FOR UPDATE TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.is_org_member(org_id))
WITH CHECK (user_id = (SELECT auth.uid()) AND public.is_org_member(org_id));

CREATE POLICY analysis_feedback_delete_own
ON public.analysis_feedback FOR DELETE TO authenticated
USING (user_id = (SELECT auth.uid()) AND public.is_org_member(org_id));

CREATE POLICY alert_channels_member_all
ON public.alert_channels FOR ALL TO authenticated
USING (public.is_org_member(org_id))
WITH CHECK (public.is_org_member(org_id));
-- Column grants above prevent authenticated users from setting verified=true.
-- The backend must set verified only after completing the channel verification flow.

CREATE POLICY alert_rules_member_all
ON public.alert_rules FOR ALL TO authenticated
USING (public.is_org_member(org_id))
WITH CHECK (public.is_org_member(org_id));

CREATE POLICY clients_member_all
ON public.clients FOR ALL TO authenticated
USING (public.is_org_member(org_id))
WITH CHECK (public.is_org_member(org_id));

CREATE POLICY client_repositories_member_all
ON public.client_repositories FOR ALL TO authenticated
USING (public.is_org_member(org_id))
WITH CHECK (public.is_org_member(org_id));

CREATE POLICY report_links_member_all
ON public.report_links FOR ALL TO authenticated
USING (public.is_org_member(org_id))
WITH CHECK (public.is_org_member(org_id));

-- Webhook queue has no authenticated policies: service role only.

-- 11. Explicit grants
REVOKE ALL ON TABLE
    public.organizations, public.memberships, public.invites,
    public.github_installations, public.repositories, public.workflow_runs,
    public.workflow_jobs, public.activity_events, public.failure_analyses,
    public.analysis_feedback, public.webhook_events, public.alert_channels,
    public.alert_rules, public.alerts_sent, public.clients,
    public.client_repositories, public.reports, public.report_links
FROM anon, authenticated;
GRANT ALL ON public.webhook_events TO service_role;

GRANT SELECT ON public.organizations TO authenticated;
GRANT INSERT (name, slug, timezone, quiet_start, quiet_end, created_by)
    ON public.organizations TO authenticated;
GRANT UPDATE (name, timezone, quiet_start, quiet_end, status, deactivated_at)
    ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;

GRANT SELECT ON public.github_installations TO authenticated;
GRANT SELECT ON public.repositories TO authenticated;
GRANT SELECT ON public.workflow_runs TO authenticated;
GRANT SELECT ON public.workflow_jobs TO authenticated;
GRANT SELECT ON public.activity_events TO authenticated;
GRANT SELECT ON public.failure_analyses TO authenticated;
GRANT SELECT ON public.alerts_sent TO authenticated;
GRANT SELECT ON public.reports TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.analysis_feedback,
    public.alert_rules,
    public.clients,
    public.client_repositories,
    public.report_links
TO authenticated;

-- Alert channel verification is server-controlled. Authenticated users may
-- create channels and edit type/target, but cannot set verified or its ID/timestamps.
GRANT SELECT ON public.alert_channels TO authenticated;
GRANT INSERT (org_id, type, target) ON public.alert_channels TO authenticated;
GRANT UPDATE (type, target) ON public.alert_channels TO authenticated;
GRANT DELETE ON public.alert_channels TO authenticated;

GRANT ALL ON
    public.github_installations,
    public.repositories,
    public.workflow_runs,
    public.workflow_jobs,
    public.activity_events,
    public.failure_analyses,
    public.alerts_sent,
    public.reports
TO service_role;

GRANT ALL ON TABLE public.alert_channels TO service_role;

GRANT ALL ON TABLE
    public.organizations, public.memberships, public.invites,
    public.github_installations, public.repositories, public.workflow_runs,
    public.workflow_jobs, public.activity_events, public.failure_analyses,
    public.analysis_feedback, public.webhook_events, public.alert_channels,
    public.alert_rules, public.alerts_sent, public.clients,
    public.client_repositories, public.reports, public.report_links
TO service_role;

REVOKE EXECUTE ON FUNCTION public.add_organization_owner_membership() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_organization_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_last_org_owner() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_owner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_org_active_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_active_owner(uuid) TO authenticated;

-- No permanent-delete policy is created for organizations.
-- Deactivation is an owner-controlled status update.

COMMIT;
