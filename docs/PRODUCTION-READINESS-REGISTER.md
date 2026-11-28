# Production Readiness Register

Last reviewed: 2026-11-27  
Repository: `Aish-369/DevOps-Insight-AI`  
Working branch: `codex/phase4-workspace-context-2026-11-27`  
Confirmed Supabase target: `mtrmvvtobbbjusiteyvp`

This register separates code/CI verification from hosted deployment and live-provider acceptance. Passing CI does not prove that GitHub, email, Telegram, AI, or browser-to-production flows are operational.

## Verified implementation and hosted database

- Supabase project `mtrmvvtobbbjusiteyvp` was previously verified `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- Hosted migration history was verified to contain seven migrations:
  - `20261112100118_create_team_workspace_foundation` (pre-existing baseline)
  - `20261125111227_secure_workspace_data_plane`
  - `20261125111400_index_phase3_foreign_keys`
  - `20261125111523_restrict_sensitive_workspace_columns`
  - `20261125111715_deny_client_access_to_internal_tables`
  - `20261125134153_reliable_event_delivery`
  - `20261125134241_index_workflow_run_attempts_fk`
- Previously verified live row counts: 3 profiles; 0 teams; 0 workflow runs; 0 workflow attempts; 0 pending workflow jobs; 0 alerts; 0 rate-limit buckets.
- Public application tables have RLS enabled. Client roles have no table access to internal workflow tables.
- `private.api_rate_limits` is in a non-exposed schema and direct client table grants are revoked. RLS was previously observed disabled on this table; no SQL change was made in this session. The latest Security Advisor response returned only the leaked-password-protection warning, so do not infer that the table's RLS configuration changed.
- The rate-limit RPC is not executable by `anon` or `authenticated`; it is executable by `service_role` (previously verified).
- The composite foreign-key index for workflow attempt history is present (previously verified).
- Latest Health Advisor check: no findings.
- Latest Security Advisor check: one warning — leaked-password protection is disabled. This capability is unavailable on the current Supabase Free plan.
- Previous Performance Advisor check reported unused-index informational findings. No indexes were removed.
- Latest Edge Function inventory check: **zero Edge Functions deployed**.

## CI verification

All three GitHub Actions workflows passed on Phase 4 head `a57e66ccdcea57affa973c73244577682e2ee6cc`:

- [Frontend CI](https://github.com/Aish-369/DevOps-Insight-AI/actions/runs/46013723272) — success.
- [Edge Functions CI](https://github.com/Aish-369/DevOps-Insight-AI/actions/runs/46013723135) — success.
- [Database Security CI](https://github.com/Aish-369/DevOps-Insight-AI/actions/runs/46013723245) — success.

The Phase 3 head `d2f970c46496367541a9b2a30e674abf3130f930` also has successful Frontend, Edge Functions and Database Security workflow runs. CI validates the code and isolated tests; it does not deploy Edge Functions or validate external providers.

## Implemented capabilities in the reviewed branch chain

- Authentication lifecycle: email/password signup and login, sign-out, password recovery/reset, protected routes and account settings. Real SMTP/OAuth delivery still requires provider setup and live testing.
- Team workspaces, invitations and owner/admin/member permissions with database-side owner invariants.
- GitHub App installation/repository sync code and signed webhook ingestion with duplicate-delivery handling.
- Workflow run/job persistence, workflow attempt history, out-of-order job reconciliation, stale-event protection and searchable workflow history.
- AI failure-analysis code with bounded/redacted logs, evidence-linked recommendations, model/prompt versioning and per-team quota. It remains an assistive analysis; no automatic code changes.
- Verified email/Telegram alert-channel code, branch rules, recovery alerts, flaky-retry suppression, idempotent email dispatch and conservative handling of ambiguous delivery outcomes.
- Database-backed rate limiting for authenticated Edge Function requests.
- Phase 4 active-workspace persistence across Teams, GitHub App Integrations and Workflow Runs pages. The user-scoped local preference stores only a workspace ID, validates it against accessible workspaces, and safely falls back if storage is blocked or the workspace is no longer available.
- Focused workspace-selection tests: 10 assertions passed.
- Member-management authorization was extracted into a pure RBAC policy module and wired into the Edge Function. Twelve focused Deno test cases cover owner/admin/member permissions, owner immutability, and invalid role assignments. These new tests are committed but awaiting GitHub Actions execution; do not mark them passed until CI reports success.
- No Supabase schema, hosted rows, provider secrets, Auth settings or Edge Function deployments were changed for Phase 4.

## Deployment blockers and owner inputs

| Item | Status | Required next action |
|---|---|---|
| Production frontend HTTPS origin | BLOCKED | Owner must provide the exact deployed URL/origin |
| Frontend Supabase environment | BLOCKED | Configure project URL and publishable key in the frontend host |
| Supabase Auth Site URL and redirect allow-list | BLOCKED | Configure only after the production origin is known |
| Real email/OAuth authentication | NOT TESTED | Configure provider/SMTP and test with controlled accounts |
| GitHub App registration | NOT TESTED | Configure App ID, slug, private key and webhook secret in secure settings |
| Edge Function secrets | BLOCKED | Configure only the providers selected for launch in Supabase Dashboard |
| Email alerts/invitations | NOT TESTED | Configure Resend and verified sender if email is enabled |
| Telegram alerts | NOT TESTED | Configure bot token if Telegram is enabled |
| AI analysis provider | NOT TESTED | Select and configure an approved OpenAI-compatible endpoint/model |
| GitHub scheduler secrets | BLOCKED | Configure `SUPABASE_FUNCTIONS_URL` and matching `ALERT_SCHEDULER_SECRET` in GitHub Actions |
| Edge Function deployment | BLOCKED | Deploy after origin, secrets and final code review are complete |
| Live end-to-end acceptance | NOT TESTED | Test auth, invitations, RBAC, GitHub webhook, workflow ingestion, AI analysis and notifications using controlled accounts and a non-production repository |
| Ordered PR integration | BLOCKED | Review and merge the dependency chain in order; do not merge stacked PRs out of order |

Never paste secret values into chat or commit them to Git. Configure secrets directly in the relevant provider dashboards.

## Security and operational notes

- The latest Security Advisor warning is leaked-password protection disabled. The current Supabase Free plan does not include the HaveIBeenPwned password check. Do not claim this warning is fixed.
- The private rate-limit table was previously observed with RLS disabled, but direct client grants were revoked and the schema is not exposed. No hardening SQL was applied in this session. Review the live catalog and advisor before deciding whether to enable RLS with a service-role-only policy.
- Keep the Supabase service-role key, GitHub App private key, webhook secret, Resend key, Telegram bot token and AI provider key out of browser variables and Git history.
- Do not reapply the seven already-recorded hosted migrations.
- The original SQL source for the pre-existing workspace foundation migration was unavailable; the repository file is a documented reconstruction. Do not use it to overwrite an existing database or provision a new database without recovering/reviewing the original source.

## Git branch / review state

- PR #8 (Phase 1 to `main`) remains open.
- PR #9 (Phase 2) and PR #10 (Phase 3) are merged into their stacked parent branches.
- PR #11 (Phase 3 reliability) remains open and draft.
- PR #12 (Phase 4 workspace context) remains open and draft, stacked on PR #11.
- Phase 4 CI is green, but the PR chain has not been fully integrated into `main`.
- Do not merge PRs, alter production Auth/security settings, deploy Edge Functions or configure provider credentials without the required review and explicit release approval.

## Release decision

**NOT PRODUCTION READY — PROVIDER CONFIGURATION, ORDERED PR INTEGRATION, EDGE FUNCTION DEPLOYMENT AND LIVE ACCEPTANCE REMAIN.**

Change this decision only after the final merged commit passes CI, frontend hosting and Auth redirects are configured, secrets are safely provisioned, Edge Functions are deployed, and end-to-end acceptance tests pass.
