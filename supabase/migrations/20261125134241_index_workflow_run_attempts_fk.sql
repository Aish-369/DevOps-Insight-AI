-- Cover the composite foreign key from workflow_run_attempts to workflow_runs.
-- The primary key starts with github_run_id but does not include team_id.
CREATE INDEX workflow_run_attempts_run_team_fk_idx
  ON public.workflow_run_attempts (github_run_id, team_id);
