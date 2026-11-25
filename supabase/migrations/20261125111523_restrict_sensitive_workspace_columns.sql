BEGIN;

-- Invitation token hashes and alert verification metadata are server-only.
-- The UI reads only the explicitly granted non-secret fields.
REVOKE SELECT ON public.team_invitations FROM authenticated;
GRANT SELECT (
  id, team_id, email, role, status, created_at, expires_at
) ON public.team_invitations TO authenticated;

REVOKE SELECT ON public.alert_channels FROM authenticated;
GRANT SELECT (
  id, team_id, channel_type, target, verified_at
) ON public.alert_channels TO authenticated;

-- Provider delivery identifiers are not needed by the client UI.
REVOKE SELECT ON public.alerts_sent FROM authenticated;
GRANT SELECT (
  id, team_id, github_run_id, kind, status, created_at
) ON public.alerts_sent TO authenticated;

COMMIT;
