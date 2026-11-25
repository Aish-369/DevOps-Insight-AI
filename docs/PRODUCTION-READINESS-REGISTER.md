# Production Readiness Register

Last reviewed: 2026-11-25  
Repository: `Aish-369/DevOps-Insight-AI`  
Working branch: `codex/phase3-platform-backend-2026-11-24`  
Confirmed Supabase target: `mtrmvvtobbbjusiteyvp`

This register distinguishes verified implementation and database migration state from live deployment. Passing isolated CI is not proof that external providers or production workflows are operational.

## Verified implementation and hosted database

- Confirmed Supabase project is `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- Hosted migration history contains seven migrations:
  - `20261112100118_create_team_workspace_foundation` (pre-existing baseline)
  - `20261125111227_secure_workspace_data_plane`
  - `20261125111400_index_phase3_foreign_keys`
  - `20261125111523_restrict_sensitive_workspace_columns`
  - `20261125111715_deny_client_access_to_internal_tables`
  - `20261125134153_reliable_event_delivery`
  - `20261125134241_index_workflow_run_attempts_fk`
- Live row counts verified: 3 profiles; 0 teams; 0 workflow runs; 0 workflow attempts; 0 pending workflow jobs; 0 alerts; 0 rate-limit buckets.
- All public application tables, including `workflow_run_attempts` and `pending_workflow_jobs`, have RLS enabled. Client roles have no table access to the new internal workflow tables.
- `private.api_rate_limits` is in a non-exposed schema and has no client table grants; `service_role` has required write access and can execute the rate-limit RPC. However, RLS is currently disabled on this private table and Supabase Security Advisor flags it. See the explicit owner decision below.
- Rate-limit RPC is not executable by `anon` or `authenticated`; it is executable by `service_role`.
- The composite foreign-key index for workflow attempt history is present. A live catalog query reports zero unindexed foreign keys.
- Supabase Health Advisor: no findings.
- Supabase Security Advisor: one warning — leaked-password protection is disabled. Supabase Free plan does not include the HaveIBeenPwned feature.
- Supabase Performance Advisor: 36 unused-index informational findings. No indexes were dropped; assess only after representative workload data exists.
- Zero Edge Functions are deployed.

## CI verification

On commit `a3180986f68aefc84bb038cfee090457caf7d5d6`, Frontend CI, Edge Functions CI and Database Security CI all passed. The follow-up database index migration and documentation update are newer commits; their CI must be checked before release.

## Implementation included in the branch

- Authenticated Edge Function requests use atomic database-backed fixed-window rate limiting: 60 requests per user/function/minute, SHA-256 key hashes and fail-closed behavior.
- Out-of-order workflow-job webhooks are persisted as normalized pending rows (not raw webhook bodies) and reconciled after parent-run arrival; unmatched rows expire after seven days.
- Workflow attempt history preserves retries; stale events cannot roll back the latest run snapshot. With `skip_flaky` enabled, a failed attempt followed by a successful later attempt suppresses unsent failure alerts. The failure alert waits for a 10-minute grace period.
- Alert dispatch distinguishes pre-send claims from provider sends. Ambiguous outcomes become `delivery_unknown` and are excluded from automatic retries. Resend email uses a stable idempotency key; Telegram unknown outcomes require provider-side checking before manual resend.
- New reliability schema migration and FK-index follow-up migration are applied to hosted Supabase and present in the working branch.
- These behaviors are not live yet because Edge Functions have not been deployed.

## Deployment blockers

| Item | Status | Required next action |
|---|---|---|
| Production frontend HTTPS origin | BLOCKED | Owner must provide the exact deployed URL/origin |
| Frontend Supabase environment | BLOCKED | Configure project URL and publishable key in frontend host |
| Supabase Auth URL settings | BLOCKED | Set Site URL and exact callback/reset allow-list after origin is known |
| Auth email/OAuth provider | NOT TESTED | Configure actual provider/SMTP and verify controlled accounts |
| Edge Function secrets | BLOCKED | Configure chosen providers securely in Supabase Dashboard |
| GitHub App | NOT TESTED | Configure App ID/slug/private key/webhook secret through secure settings |
| Email alerts/invitations | NOT TESTED | Configure Resend and verified sender if email is enabled |
| Telegram alerts | NOT TESTED | Configure bot token if Telegram is enabled |
| AI analysis | NOT TESTED | Select and configure approved OpenAI-compatible provider/model |
| GitHub scheduler | BLOCKED | Add `SUPABASE_FUNCTIONS_URL` and matching `ALERT_SCHEDULER_SECRET` repository secrets |
| Edge Function deployment | BLOCKED | Deploy only after exact frontend origin and required secrets are configured |
| Live end-to-end acceptance | NOT TESTED | Use controlled accounts and a non-production GitHub repository |

Never paste secret values into chat or commit them to Git. Set secrets in the Supabase Dashboard and GitHub Actions secret settings.

## Explicit security-advisor item requiring owner decision

Supabase Security Advisor flags `private.api_rate_limits` because RLS is disabled. The table is in the non-exposed `private` schema and direct table privileges are revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role` has access. This is not currently a client-accessible table, but RLS is useful defense-in-depth.

Proposed hardening SQL (not applied):

```sql
ALTER TABLE private.api_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_rate_limits_service_role_only
  ON private.api_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

Do not apply until the owner confirms this policy choice. The Supabase advisor's RLS warning must remain visible until resolved.

## Git branch / review state

- PR #11 remains open and draft; it has not been merged.
- The current Phase 3 branch is based on the Phase 2 branch; the phase chain to `main` is not complete.
- Do not merge PRs or deploy without explicit owner approval.

## Release decision

**NOT PRODUCTION READY — EXTERNAL CONFIGURATION AND LIVE ACCEPTANCE REMAIN.**

Do not change this decision until final-commit CI, frontend hosting, Auth configuration, secrets, Edge Function deployment, provider integration and end-to-end acceptance checks all pass.
