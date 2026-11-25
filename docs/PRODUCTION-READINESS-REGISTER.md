# Production Readiness Register

Last reviewed: 2026-11-25  
Repository: `Aish-369/DevOps-Insight-AI`  
Working branch: `codex/phase3-platform-backend-2026-11-24`  
Confirmed Supabase target: `mtrmvvtobbbjusiteyvp`

This register distinguishes verified implementation from live deployment. A passing isolated CI run is not proof that external providers or production workflows are operational.

## Verified

- The confirmed Supabase project is `ACTIVE_HEALTHY`.
- Hosted migration history contains the pre-existing workspace baseline and four incremental Phase 3 migrations:
  - `20261112100118_create_team_workspace_foundation`
  - `20261125111227_secure_workspace_data_plane`
  - `20261125111400_index_phase3_foreign_keys`
  - `20261125111523_restrict_sensitive_workspace_columns`
  - `20261125111715_deny_client_access_to_internal_tables`
- All 19 public application tables have RLS enabled.
- The three internal tables `webhook_events`, `github_installation_states` and `team_ai_usage` have explicit client-deny policies.
- The live database currently contains 3 profile rows; the other 18 application tables have zero rows.
- Security Advisor: leaked-password protection is disabled. Supabase documents this control as Pro-and-above; the warning remains on the Free plan.
- Performance Advisor: 32 unused-index informational findings. Do not drop these without workload evidence.
- Health Advisor: no findings.
- The confirmed project currently has zero deployed Edge Functions.
- The PR #10 code tree passed Frontend CI, Edge Functions CI and Database Security CI on its PR head. The source branch's later hardening changes are tracked by the latest Actions runs and must be rechecked before release.

## Deployment blockers

| Item | Status | Required next action |
|---|---|---|
| Production frontend URL | BLOCKED | Owner must provide the deployed HTTPS origin |
| Frontend Supabase environment | BLOCKED | Set the confirmed project's URL and publishable key in hosting configuration |
| Supabase Auth URL settings | BLOCKED | Configure Site URL and exact callback/reset allow-list after domain confirmation |
| Auth email/OAuth provider | NOT TESTED | Configure actual provider/SMTP and verify with controlled accounts |
| Edge Function secrets | BLOCKED | Configure only the providers the owner chooses in Supabase Dashboard |
| GitHub App | NOT TESTED | Supply App ID/slug/private key/webhook secret through secure secret settings |
| Email alerts/invitations | NOT TESTED | Configure Resend and verified sender if email is enabled |
| Telegram alerts | NOT TESTED | Configure bot token if Telegram is enabled |
| AI analysis | NOT TESTED | Choose and configure an approved OpenAI-compatible provider/model |
| Scheduler | BLOCKED | Configure GitHub repository secrets and verify authenticated dispatch |
| Edge Function deployment | BLOCKED | Deploy only after origin/secrets/source checks; no functions are currently deployed |
| Live end-to-end acceptance | NOT TESTED | Use controlled accounts and a non-production GitHub repository |

Never paste secret values into chat or commit them to Git.

## Implementation changes on the current branch — CI verification pending

- User-authenticated Edge Function requests now use an atomic database-backed fixed-window limiter: 60 requests per user per function per minute. The key is a SHA-256 hash; the limiter fails closed if its database RPC is unavailable. GitHub webhooks remain protected by HMAC verification and delivery deduplication; the scheduler uses its independent shared secret.
- Workflow-job events received before their parent run are stored as normalized fields (never raw webhook bodies) in `pending_workflow_jobs`. Parent-run synchronization reconciles those rows; the job handler rechecks the parent after inserting to close the event-order race. Unmatched pending jobs expire after seven days.
- `workflow_run_attempts` retains each attempt and database triggers prevent stale attempt events from rolling back the latest run snapshot. With `skip_flaky` enabled, a failure followed by a successful latest attempt is classified as flaky and pending/pre-send failure alerts are suppressed. Failure alerts have a 10-minute grace period to allow an immediate rerun to arrive. Alerts already sent cannot be recalled.
- Alert dispatch now separates the pre-send `processing` claim from provider `sending`. Stale `sending` rows become `delivery_unknown` and are never automatically retried, preventing duplicate Telegram sends when provider acceptance is ambiguous. Resend email requests also carry a stable idempotency key. Unknown outcomes require provider-side reconciliation before any manual resend.
- Request JSON is streamed with a 16 KB limit; GitHub webhook bodies are streamed with a 2 MB limit. AI log ZIP extraction has per-file, file-count and aggregate expansion limits. GitHub API GET/HEAD requests use bounded timeout handling and up to two transient-error retries.
- The new migration `20261125112000_reliable_event_delivery.sql` is in the branch and covered by Database Security CI, but has **not** been applied to the hosted Supabase project.
- Current Playwright tests mock the Supabase Auth HTTP boundary. They do not verify live signup, confirmation email, OAuth, password recovery, team isolation, GitHub App, AI, or alert delivery.

## Migration provenance warning

The original source SQL for the already-applied workspace foundation migration was not available in the repository. The repository file `20261112100118_create_team_workspace_foundation.sql` is a documented reconstruction from read-only catalog inspection. It was not reapplied to the existing hosted project. Do not use it to overwrite or provision another database until compared with the original source.

## Git branch / review state

- PR #9 (Phase 2) was merged into the Phase 1 branch.
- PR #10 (Phase 3) was merged into the Phase 2 branch.
- PR #8 (Phase 1 to `main`) remains open.
- The phase chain has not yet been merged into `main`. Do not merge or deploy as part of this work without explicit owner approval.

## Release decision

**NOT PRODUCTION READY — BLOCKERS REMAIN**

Do not change this decision until all required CI checks on the final commit, hosted deployment checks, provider integrations, authorization tests and end-to-end acceptance tests have passed with recorded evidence.
