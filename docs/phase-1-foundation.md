# Phase 1 — Foundation and Code Quality

**Status: CI quality gates passing; browser-route regression tests remain outstanding.**

## Scope

This change hardens the existing `frontend/` application without deleting the legacy root `src/` tree or applying any database changes. `frontend/` remains the active application because the current CI workflow and setup use it.

## Changes in this pull request

- Validate the Supabase URL before initializing the browser client.
- Permit only modern Supabase publishable keys or legacy JWT keys whose decoded role is `anon`. This is a format/role guard, not cryptographic JWT verification.
- Ensure frontend environment variables are documented and never ask users to place a service-role key in Vite configuration.
- Normalize unknown request failures and handle login, GitHub OAuth and signup failures without leaving forms stuck in a loading state.
- Handle protected-route session initialization races and expose a retry path when the session cannot be verified.
- Treat Supabase's explicit missing-session error as a normal signed-out state so an unauthenticated user is redirected to login instead of seeing a false session-verification error.
- Enable TypeScript `strict` mode in the canonical frontend.
- Add a stable Vite security-version gate and dependency-independent foundation tests.
- Add CI gates for audit, security policy, unit tests, browser regression tests, lint, strict typecheck and production build.
- Refresh the two duplicate dependency lockfiles through npm in a branch-scoped GitHub Actions workflow; do not hand-edit lock metadata.

## Explicitly not changed

- No Supabase project settings, Auth settings, schema, RLS policies, migrations or customer data.
- No GitHub App credentials, webhook secrets or production integrations.
- No deletion of the root legacy app, `apps/web`, or the separate open PR branch.
- No claim that repository monitoring, alerts or AI failure analysis are production features.

## Verified CI evidence

- Clean npm install.
- Moderate dependency audit: zero vulnerabilities.
- Stable Vite 8.3.8 passes the 8.3.7 patched-version floor.
- Foundation unit tests pass.
- ESLint passes.
- Strict TypeScript passes.
- Production Vite build passes.

The production build currently emits a minified JavaScript entry chunk above 500 kB. Route-level code splitting is a follow-up performance improvement.

## Browser regression coverage

Browser checks use a dedicated local Supabase URL and a fake legacy anon-shaped key; all Supabase Auth HTTP calls in the tests are stubbed. These tests validate frontend routing and error/loading behavior, not real provider delivery or live customer accounts.

## Still outstanding

- Real Supabase email, OAuth, recovery and reset flow tests using configured providers and controlled test accounts.
- Cross-tenant authorization and database isolation tests.

A CI build is not proof that the complete SaaS product is production-ready.
