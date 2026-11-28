# Phase 3 — Database security and live verification

**Target:** Supabase project `mtrmvvtobbbjusiteyvp` (confirmed by the project owner)  
**Last verified:** 2026-11-25  
**Status:** Database migrations applied successfully. Edge Functions are not yet deployed.

## Applied migration history

The hosted project reports these exact migration versions:

1. `20261112100118_create_team_workspace_foundation` — pre-existing workspace foundation.
2. `20261125111227_secure_workspace_data_plane` — RLS, private helper functions, least-privilege grants, server-managed data plane and workspace ownership guard.
3. `20261125111400_index_phase3_foreign_keys` — indexes covering the 12 foreign keys identified by the performance advisor.
4. `20261125111523_restrict_sensitive_workspace_columns` — hides invitation token hashes, alert verification metadata and provider message IDs from authenticated browser clients.
5. `20261125111715_deny_client_access_to_internal_tables` — explicit deny policies for internal webhook, installation-state and AI-usage tables.

The repository migration filenames are aligned with the hosted migration versions. Do not reapply these migrations manually.

The current branch additionally contains `20261125112000_reliable_event_delivery.sql`. This is a **pending, unapplied migration**, not part of the hosted migration history above. It adds:
- private, service-role-only API rate-limit buckets and an atomic `consume_api_rate_limit` function;
- RLS-protected workflow-attempt history and pending normalized workflow-job records;
- latest-attempt guards against stale webhook updates;
- alert availability timestamps and `sending` / `delivery_unknown` states to prevent blind retries after ambiguous provider outcomes.

The updated Database Security CI applies this migration to its disposable PostgreSQL test database and exercises the new grants, rate-limit behavior, attempt-history ordering and RLS. Do not apply it to the hosted project until CI passes and the owner separately approves the migration/deployment step.

## Baseline caveat

The original source for the already-applied workspace foundation migration was not available in the repository. The file `20261112100118_create_team_workspace_foundation.sql` is a documented reconstruction from read-only catalog inspection. It was not reapplied to the hosted project. Compare it with the original source if it is recovered before using it to provision a different database.

## Live checks performed

- The incremental security migration passed a transaction/rollback validation before application.
- Supabase reported success for all four incremental migrations.
- All 19 public application tables have RLS enabled.
- Internal tables `webhook_events`, `github_installation_states` and `team_ai_usage` have explicit client-deny policies and no client table grants.
- Team membership/admin helpers live in the non-exposed `private` schema. Anonymous execution is denied; authenticated users can execute only the two helpers needed by RLS.
- The AI quota claim function is executable only by `service_role`.
- Authenticated users cannot read `team_invitations.token_hash`, `alert_channels.verification_code_hash`, verification expiry/attempt metadata or `alerts_sent.provider_message_id`. Required UI columns remain readable.
- The duplicate `profiles(id) → auth.users(id)` foreign key was removed; the equivalent FK remains.
- All four pre-existing workspace table row counts checked before and after migration remained zero. No existing workspace rows were deleted or rewritten.
- The performance advisor no longer reports unindexed foreign keys.
- No Edge Functions are currently deployed to the target project.

## Remaining advisor findings

- **Leaked password protection disabled (WARN):** Supabase documents this HaveIBeenPwned-based control as available on Pro and above. It cannot be enabled on the Free plan. Keep a strong minimum password length and character requirements in Auth settings; the advisor warning will remain while on Free.
- **Unused indexes (INFO):** 32 indexes are currently reported unused. The new tables have not received production workload yet, so these are not grounds for dropping indexes. Reassess after real query traffic.
- The three former “RLS enabled, no policy” informational findings are cleared by explicit client-deny policies.

## CI status

Database Security CI passed on head `e0ba357df823d349b4a53e7a09a9da2c15c319e7` ([run 45615723065](https://github.com/Aish-369/DevOps-Insight-AI/actions/runs/45615723065)). It applied the baseline, four hosted incremental migrations and the new branch-only reliability migration to a disposable PostgreSQL test database before running the SQL integration tests. The hosted project has not yet received the new migration.

## Production readiness boundary

The database hardening is applied, but this does not mean the whole product is production-ready. External provider secrets, the browser origin, Edge Function deployment, Auth redirect settings and end-to-end provider tests remain outstanding.
