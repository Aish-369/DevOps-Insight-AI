export interface WorkflowAttemptSummary {
  run_attempt: number;
  status: string | null;
  conclusion: string | null;
}

/** A run is flaky only when its latest attempt completed successfully after a failure. */
export function isFlakyWorkflowAttempts(
  attempts: readonly WorkflowAttemptSummary[],
): boolean {
  if (attempts.length === 0) return false;
  const latest = attempts.reduce((current, candidate) =>
    candidate.run_attempt > current.run_attempt ? candidate : current
  );
  return latest.status === "completed" && latest.conclusion === "success" &&
    attempts.some((attempt) =>
      attempt.run_attempt < latest.run_attempt &&
      attempt.conclusion === "failure"
    );
}
