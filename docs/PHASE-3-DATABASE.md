# Phase 3 — Database security and platform data plane

**Status: Isolated PostgreSQL integration tests PASS on the Phase 3 branch. The migration has NOT been applied to the connected/production Supabase project.**

## Schema lineage

The connected project reported one applied migration: `20261112100118_create_team_workspace_foundation`. Its SQL source was not present in the GitHub repository. The file with that exact applied version is reconstructed from read-only database catalog, table, policy, trigger, function, grant and index inspection as of 2026-11-24. It reproduces the verified schema needed for a fresh local database and preserves the existing version marker. It must be compared with the original migration source if it is later recovered.

## Security and data-plane changes

- Move RLS `SECURITY DEFINER` helpers out of exposed `public` into `private`.
- Remove exposed helper functions after repointing the owner-membership trigger.
- Revoke broad `anon` and `authenticated` grants and regrant only the columns/actions used by the browser.
- Reduce PostgreSQL default privileges for newly created objects.
- Make invitation/member mutations server-controlled.
- Preserve profile ownership and prevent browser-side changes to team owner IDs, project creator IDs, membership, invitation state, or channel verification.
- Remove the duplicate profiles-to-auth.users foreign key.
- Add indexes for previously unindexed foreign keys.
- Add team-scoped GitHub installation, repository, workflow, activity, webhook delivery, AI analysis, notification, usage-quota and audit tables.
- Enable RLS for every app table; private event state and server-managed writes have no authenticated table grants.
- Protect the final team owner while preserving workspace deletion cascades.

## Tests executed

The permanent **Database Security CI** workflow runs PostgreSQL 17.11 in an isolated GitHub Actions service container. It builds a test-only Supabase Auth shim, applies the reconstructed baseline, applies the incremental migration, and runs the security integration script.

Verified assertions include:
- RLS enabled on every application table.
- `anon` cannot read or write application tables.
- Authenticated roles have narrow table/column grants only.
- Team membership RLS prevents cross-team reads.
- Auth profile-creation trigger matches the observed remote trigger behavior.
- Webhook and GitHub installation state are not directly exposed.
- Private helper functions are not executable by `anon`.
- Future public tables/functions do not inherit broad defaults.
- The duplicate profile foreign key is removed.
- Atomic team AI quota cannot be claimed above the daily cap.
- The last owner cannot be removed/demoted, but the owner can delete the workspace and related memberships cascade.
- Owner membership is automatically created for new workspaces.

The latest verified Phase 3 commit has green **Database Security CI**, **Edge Functions CI**, and **Frontend CI**. These are isolated CI tests; they do not prove hosted project configuration, live provider credentials, real email delivery, GitHub App installation, or a production migration.

## Hosted deployment blockers

The connected Supabase project was healthy and had the expected workspace schema, but the app's frontend env template is placeholder-only. The repository's production Supabase project therefore remains unconfirmed. Do not run `supabase db push --remote` until the exact project reference and migration history are confirmed with the project operator.

No storage buckets currently exist. No live database data was changed by these tests or this branch.
