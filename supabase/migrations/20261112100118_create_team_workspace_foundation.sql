-- Reconstructed baseline for the already-applied remote migration
-- version 20261112100118_create_team_workspace_foundation.
-- The original SQL source was absent from the repository. This file reproduces
-- the verified public schema, policies, triggers, grants and indexes observed
-- on the connected database at 2026-11-24. It is not applied to a database that
-- already records this migration version.
BEGIN;

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  display_name text,
  github_username text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_id_auth_users_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])),
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_members_team_user_unique UNIQUE (team_id, user_id)
);
CREATE INDEX team_members_team_id_idx ON public.team_members(team_id);
CREATE INDEX team_members_user_id_idx ON public.team_members(user_id);

CREATE TABLE public.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member'
    CHECK (role = ANY (ARRAY['admin'::text, 'member'::text])),
  invited_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE UNIQUE INDEX team_invitations_pending_unique
  ON public.team_invitations(team_id, lower(email))
  WHERE status = 'pending';

CREATE TABLE public.team_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  name text NOT NULL,
  repository_url text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_projects_team_id_idx ON public.team_projects(team_id);

CREATE OR REPLACE FUNCTION public.is_team_member(check_team_id uuid)
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

CREATE OR REPLACE FUNCTION public.is_team_admin(check_team_id uuid)
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

CREATE OR REPLACE FUNCTION public.add_team_owner_membership()
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

CREATE TRIGGER on_team_created_add_owner
AFTER INSERT ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.add_team_owner_membership();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

CREATE POLICY "Team members can view workspace" ON public.teams
  FOR SELECT TO authenticated USING (public.is_team_member(id));
CREATE POLICY "Workspace owners can delete workspace" ON public.teams
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY "Team admins can update workspace" ON public.teams
  FOR UPDATE TO authenticated
  USING (public.is_team_admin(id))
  WITH CHECK (public.is_team_admin(id));
CREATE POLICY "Users can create owned workspaces" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "Team members can view membership" ON public.team_members
  FOR SELECT TO authenticated USING (public.is_team_member(team_id));

CREATE POLICY "Team admins can create invitations" ON public.team_invitations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_admin(team_id) AND invited_by = (SELECT auth.uid()));
CREATE POLICY "Team admins can view invitations" ON public.team_invitations
  FOR SELECT TO authenticated USING (public.is_team_admin(team_id));
CREATE POLICY "Team admins can delete invitations" ON public.team_invitations
  FOR DELETE TO authenticated USING (public.is_team_admin(team_id));

CREATE POLICY "Team members can create projects" ON public.team_projects
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_member(team_id) AND created_by = (SELECT auth.uid()));
CREATE POLICY "Team admins can update projects" ON public.team_projects
  FOR UPDATE TO authenticated
  USING (public.is_team_admin(team_id))
  WITH CHECK (public.is_team_admin(team_id));
CREATE POLICY "Team admins can delete projects" ON public.team_projects
  FOR DELETE TO authenticated USING (public.is_team_admin(team_id));
CREATE POLICY "Team members can view projects" ON public.team_projects
  FOR SELECT TO authenticated USING (public.is_team_member(team_id));

GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.teams TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.team_members TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.team_invitations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.team_projects TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

COMMIT;
