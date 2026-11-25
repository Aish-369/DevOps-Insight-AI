BEGIN;

-- Make the client-deny posture explicit for service-only tables.
-- service_role bypasses RLS; anon/authenticated receive no table grants.
CREATE POLICY webhook_events_deny_client
  ON public.webhook_events
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY github_installation_states_deny_client
  ON public.github_installation_states
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY team_ai_usage_deny_client
  ON public.team_ai_usage
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;
