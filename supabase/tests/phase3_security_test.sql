BEGIN;

DO $$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'profiles','teams','team_members','team_invitations','team_projects',
    'github_installations','team_repositories','workflow_runs','workflow_jobs',
    'activity_events','webhook_events','failure_analyses','analysis_feedback',
    'alert_channels','alert_rules','alerts_sent','team_audit_events',
    'github_installation_states'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = app_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', app_table;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.teams', 'SELECT') THEN
    RAISE EXCEPTION 'anon unexpectedly has SELECT on teams';
  END IF;
  IF has_table_privilege('anon', 'public.profiles', 'INSERT') THEN
    RAISE EXCEPTION 'anon unexpectedly has INSERT on profiles';
  END IF;
  IF has_table_privilege('authenticated', 'public.team_members', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has INSERT on team_members';
  END IF;
  IF has_table_privilege('authenticated', 'public.team_invitations', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has INSERT on team_invitations';
  END IF;
  IF has_table_privilege('authenticated', 'public.webhook_events', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has SELECT on webhook_events';
  END IF;
  IF has_table_privilege('authenticated', 'public.github_installation_states', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has SELECT on github_installation_states';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'anon unexpectedly has USAGE on private schema';
  END IF;
  IF has_table_privilege('authenticated', 'public.alert_rules', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can update alert_rules primary key';
  END IF;
  IF has_column_privilege('authenticated', 'public.analysis_feedback', 'team_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can move feedback to another team';
  END IF;
  IF has_column_privilege('authenticated', 'public.teams', 'owner_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can modify teams.owner_id';
  END IF;
  IF has_column_privilege('authenticated', 'public.team_projects', 'created_by', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can modify team_projects.created_by';
  END IF;
  IF has_column_privilege('authenticated', 'public.alert_channels', 'verified_at', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated can modify alert_channels.verified_at';
  END IF;
  IF has_function_privilege('anon', 'private.is_team_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute private.is_team_member';
  END IF;
  IF NOT has_function_privilege('authenticated', 'private.is_team_member(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute the RLS helper';
  END IF;
  IF to_regprocedure('public.is_team_member(uuid)') IS NOT NULL
     OR to_regprocedure('public.is_team_admin(uuid)') IS NOT NULL
     OR to_regprocedure('public.add_team_owner_membership()') IS NOT NULL THEN
    RAISE EXCEPTION 'legacy exposed SECURITY DEFINER functions still exist';
  END IF;
  CREATE TABLE public.default_privilege_probe (id uuid);
  IF has_table_privilege('anon', 'public.default_privilege_probe', 'SELECT')
     OR has_table_privilege('authenticated', 'public.default_privilege_probe', 'SELECT') THEN
    RAISE EXCEPTION 'new public tables inherit broad default SELECT privileges';
  END IF;
  CREATE FUNCTION public.default_function_probe() RETURNS integer
  LANGUAGE sql AS 'SELECT 1';
  IF has_function_privilege('anon', 'public.default_function_probe()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.default_function_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'new public functions inherit broad default EXECUTE privileges';
  END IF;
  DROP FUNCTION public.default_function_probe();
  DROP TABLE public.default_privilege_probe;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_id_auth_users_fkey'
  ) THEN
    RAISE EXCEPTION 'duplicate profiles foreign key remains';
  END IF;
END
$$;

INSERT INTO auth.users(id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner-one@example.test'),
  ('00000000-0000-0000-0000-000000000002', 'owner-two@example.test'),
  ('00000000-0000-0000-0000-000000000003', 'member-one@example.test');

INSERT INTO public.profiles(id, display_name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Owner One'),
  ('00000000-0000-0000-0000-000000000002', 'Owner Two');

INSERT INTO public.teams(id, name, owner_id) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Team One', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Team Two', '00000000-0000-0000-0000-000000000002');

INSERT INTO public.team_members(team_id,user_id,role)
VALUES ('10000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000003','member');

INSERT INTO public.github_installations(installation_id,team_id,account_login,account_type)
VALUES (9001,'10000000-0000-0000-0000-000000000001','team-one','Organization');
INSERT INTO public.team_repositories(github_repo_id,team_id,installation_id,full_name)
VALUES (8001,'10000000-0000-0000-0000-000000000001',9001,'team-one/service');
INSERT INTO public.workflow_runs(github_run_id,team_id,github_repo_id,workflow_name,run_number,status,conclusion)
VALUES (7001,'10000000-0000-0000-0000-000000000001',8001,'CI',10,'completed','failure');

-- User 1 is a member of Team One only: RLS must hide Team Two.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.teams) <> 1 THEN
    RAISE EXCEPTION 'Team One owner can see rows outside their team';
  END IF;
  IF (SELECT count(*) FROM public.github_installations) <> 1 THEN
    RAISE EXCEPTION 'Team One owner cannot read their GitHub installation';
  END IF;
  IF (SELECT count(*) FROM public.workflow_runs) <> 1 THEN
    RAISE EXCEPTION 'Team One owner cannot read workflow runs';
  END IF;
  IF (SELECT count(*) FROM public.profiles) <> 1 THEN
    RAISE EXCEPTION 'User can see another profile';
  END IF;
END
$$;

-- User 3 is a normal member. They may read team data but cannot create invites.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.teams) <> 1 THEN
    RAISE EXCEPTION 'Member cannot see their team';
  END IF;
  IF (SELECT count(*) FROM public.team_repositories) <> 1 THEN
    RAISE EXCEPTION 'Member cannot read team repositories';
  END IF;
  IF has_table_privilege(current_user,'public.team_invitations','INSERT') THEN
    RAISE EXCEPTION 'Member has direct invite write permission';
  END IF;
END
$$;

RESET ROLE;

-- The trigger continues to create an owner membership for newly created teams.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO public.teams(name, owner_id) VALUES
  ('New Team', '00000000-0000-0000-0000-000000000002');
RESET ROLE;

DO $$
DECLARE
  new_team_id uuid;
BEGIN
  SELECT id INTO new_team_id FROM public.teams WHERE name = 'New Team';
  IF NOT EXISTS (
    SELECT 1 FROM public.team_members AS tm
    WHERE tm.team_id = new_team_id
      AND tm.user_id = '00000000-0000-0000-0000-000000000002'
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'New team owner membership trigger did not run';
  END IF;
END
$$;

ROLLBACK;
