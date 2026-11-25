BEGIN;

-- Cover foreign keys that Supabase's performance advisor identified after
-- the Phase 3 data-plane migration. Keep index column order aligned with
-- each FK's referencing columns.
CREATE INDEX IF NOT EXISTS activity_events_repo_team_idx
  ON public.activity_events(github_repo_id, team_id);
CREATE INDEX IF NOT EXISTS alert_channels_created_by_idx
  ON public.alert_channels(created_by);
CREATE INDEX IF NOT EXISTS alerts_sent_channel_team_idx
  ON public.alerts_sent(channel_id, team_id);
CREATE INDEX IF NOT EXISTS alerts_sent_run_team_idx
  ON public.alerts_sent(github_run_id, team_id);
CREATE INDEX IF NOT EXISTS analysis_feedback_analysis_team_idx
  ON public.analysis_feedback(analysis_id, team_id);
CREATE INDEX IF NOT EXISTS analysis_feedback_user_idx
  ON public.analysis_feedback(user_id);
CREATE INDEX IF NOT EXISTS failure_analyses_job_team_idx
  ON public.failure_analyses(github_job_id, team_id);
CREATE INDEX IF NOT EXISTS github_installation_states_team_idx
  ON public.github_installation_states(team_id);
CREATE INDEX IF NOT EXISTS github_installation_states_user_idx
  ON public.github_installation_states(user_id);
CREATE INDEX IF NOT EXISTS github_installations_created_by_idx
  ON public.github_installations(created_by);
CREATE INDEX IF NOT EXISTS team_audit_events_actor_user_idx
  ON public.team_audit_events(actor_user_id);
CREATE INDEX IF NOT EXISTS team_audit_events_subject_user_idx
  ON public.team_audit_events(subject_user_id);

COMMIT;
