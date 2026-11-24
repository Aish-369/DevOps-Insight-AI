# Phase 3 — Database security and platform data plane

**Status: Migration and integration tests are in review. Not applied to the connected Supabase database.**

## Schema lineage

The connected project reported one applied migration: `20261112100118_create_team_workspace_foundation`. Its SQL source was not present in the GitHub repository. The file with that exact applied version is reconstructed from read-only database catalog, table, policy, trigger, function, grant and index inspection as of 2026-11-24. It reproduces the verified schema needed for a fresh local database and preserves the existing version marker. It must be compared with the original migration source if it is later recovered.

## Security changes in this phase

- Move RLS `SECURITY DEFINER` helpers out of exposed `public` into `private`.
- Remove public trigger/helper functions after repointing the owner-membership trigger.
- Revoke broad `anon` and `authenticated` grants and regrant only the columns/actions used by the current frontend.
- Reduce PostgreSQL default privileges for new objects created by the migration owner.
- Make invitation mutations server-controlled; the browser can only list pending invitations for admins.
- Preserve profile ownership and prevent browser-side changes to team owner IDs, project creator IDs, invitation membership, or notification verification.
- Remove the duplicate profiles-to-auth.users foreign key.
- Add indexes for the three unindexed foreign keys.
- Add team-scoped GitHub installation, repository, workflow, activity, webhook delivery, AI analysis, notification and audit tables.
- Enable RLS for all new exposed tables. Webhook state, installation OAuth state and service-managed writes have no authenticated table grants.

## Test strategy

The database CI workflow runs PostgreSQL 17.11 with a minimal test-only `auth.users` table and `auth.uid()` shim. It applies the reconstructed baseline and the phase migration, then verifies:
- Every app table has RLS enabled.
- `anon` cannot read or write application tables.
- `authenticated` has only narrow table/column privileges.
- Team membership RLS prevents cross-team reads.
- Invitation writes and webhook/private GitHub install state are server-only.
- Private helpers are unavailable to `anon`; the old exposed helper functions are gone.
- Team owner membership creation still works after moving the trigger function.

This is a PostgreSQL integration test, not a live Supabase Edge Runtime or project migration test. Supabase-specific advisors and migration drift checks must be run against a confirmed development project before production apply.

## Important deployment blockers

The connected Supabase project is healthy and has the expected `teams` schema, but the frontend's environment template is still placeholder-only, so the repository's production Supabase project is not conclusively identified. Do not run `supabase db push --remote` until the project/domain mapping is confirmed, and do not merge the migration into a live database as part of automated CI.

No storage buckets currently exist. The current database has no user data in teams/workspaces, but this migration preserves all existing data and does not drop application tables.
