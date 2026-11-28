<div align="center">

# DevOps Insight AI

### Team workspaces, GitHub CI monitoring, failure analysis and delivery alerts

**A React + Supabase application that connects GitHub App installations to team workspaces and turns GitHub Actions events into searchable workflow history and reviewable failure insights.**

[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.3.8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Edge%20Functions-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)

</div>

---

## What is implemented in this branch

### Authentication and workspaces
- Email/password sign-up, sign-in, sign-out, password recovery and reset flows, protected routes, and Supabase Auth callback handling.
- Team workspaces with owner/admin/member roles.
- Team invitations with single-use random tokens, hashed token storage, seven-day expiry, verified-email matching, revoke support, and server-side acceptance.
- Member role management and removal. The database prevents removal/demotion of the final workspace owner.
- Active workspace selection persists across Teams, GitHub App Integrations and Workflow Runs pages, scoped by authenticated user and validated against accessible workspaces.

### GitHub integration and monitoring
- GitHub App installation flow bound to an authenticated workspace admin through a short-lived one-time state token.
- Installation metadata and repository sync using short-lived GitHub installation tokens.
- Signed GitHub webhook endpoint. It verifies the raw request body with HMAC-SHA256, rejects duplicate delivery IDs, records only a payload digest (not the raw payload), and reconciles installation, repository, workflow-run, job, push and pull-request events.
- Team-scoped workflow history and links to the corresponding GitHub Actions run.
- Durable workflow-attempt history, out-of-order job reconciliation, stale-event protection and shared database-backed rate limiting.

### AI failure analysis
- Authenticated team members can request analysis of completed unsuccessful workflow runs.
- Logs are size-bounded and common credential patterns are redacted before they are sent to the configured OpenAI-compatible chat-completions endpoint.
- Results are stored with evidence, proposed next steps, model/prompt version and a confidence label.
- Daily usage is reserved by an atomic PostgreSQL function and capped per team.
- AI output is an assistive hypothesis. It does not apply code changes automatically and must be reviewed against the original logs.

### Alerts
- Email and Telegram destinations require a verification code before they can receive alerts.
- Alert rules support branch filters, recovery notifications and `skip_flaky` (suppress a failed-run alert when a later retry succeeds; a 10-minute grace period allows an immediate rerun).
- Delivery records use deduplication keys and atomic claims. Resend email uses an idempotency key; ambiguous provider outcomes become `delivery_unknown` and are never blindly retried. Check provider logs before any manual resend.
- A five-minute GitHub Actions scheduler is included. It only activates after the required repository secrets and Supabase Edge Function secret have been configured and the workflow is present on the default branch.

## Architecture

| Layer | Technology | Responsibility |
|---|---|---|
| Browser | React 19, TypeScript, Vite 8 | Authentication UI, workspaces, integrations, workflow history, alert settings |
| Data/auth | Supabase Auth + PostgreSQL | User identity, team membership, RLS, event/analysis/alert persistence |
| Server | Supabase Edge Functions (Deno 2) | Invitations, GitHub App, webhook verification, AI analysis, alert delivery |
| GitHub | GitHub App + webhooks | Repository access, workflow events, logs |
| Email | Resend | Invitation and verified alert delivery |
| Telegram | Telegram Bot API | Verified chat delivery |
| AI | Configurable OpenAI-compatible endpoint | Evidence-based CI log analysis |

The frontend talks to Supabase using only a publishable/anon key. The service-role key and all provider secrets remain in Edge Function/server configuration and are never Vite variables.

## Important deployment status

**This branch contains the implemented code and isolated tests; it is not a live production deployment.**

- The project owner confirmed Supabase project `mtrmvvtobbbjusiteyvp` as the target. It was previously verified active and healthy.
- Seven hosted migrations were previously verified as applied. Do not reapply them.
- No Edge Functions are currently deployed. Auth redirect settings, GitHub App, email, Telegram, AI and scheduler secrets remain unconfigured; the production frontend URL is still unknown.
- Invitations, GitHub webhooks, AI analysis and alert delivery cannot be considered live until the operations guide setup and end-to-end checks are completed.
- The original SQL source for the already-applied workspace foundation migration was unavailable. The file `20261112100118_create_team_workspace_foundation.sql` is a documented reconstruction from read-only catalog inspection. It was not reapplied to the existing project. Compare it with the original source before using it to provision a new database.
- Reliability migrations are applied to the hosted database, including durable workflow-attempt history, pending-job reconciliation, shared rate-limit storage and safe alert-delivery states. The Edge Functions are still not deployed, so these behaviors are not live.
- The latest Supabase Security Advisor check returned one warning: leaked-password protection is disabled. This capability is unavailable on the current Supabase Free plan.

## Getting started — frontend

Prerequisites: Node.js 22.16.0 and npm.

    git clone https://github.com/Aish-369/DevOps-Insight-AI.git
    cd DevOps-Insight-AI/frontend
    npm ci

Copy frontend/.env.example to frontend/.env.local and set:

    VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
    VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY

Use a Supabase publishable key or legacy anon key. Never put service_role, a secret key, GitHub private keys, provider tokens or webhook secrets in a VITE_ variable.

Start the app:

    npm run dev

Build it:

    npm run build

## Tests

Frontend:

    cd frontend
    npm ci
    npm test
    npm run lint
    npm run typecheck
    npm run build
    npx playwright install chromium
    npm run test:e2e

Edge Functions:

    cd supabase/functions
    deno install --frozen
    deno task check
    deno task lint
    deno task fmt:check
    deno task test

Database CI runs PostgreSQL 17.11 in an isolated GitHub Actions service container. It creates test-only Supabase Auth primitives and applies the reconstructed workspace baseline plus all six incremental migrations. It tests RLS/privileges, sensitive-column access, foreign-key indexes, cross-team isolation, owner invariants, cascade behavior, atomic AI quota, shared rate-limit behavior, workflow-attempt ordering and delivery-state constraints. It does not connect to or modify the hosted Supabase project.

## Supabase and provider setup

Follow docs/PHASE-3-OPERATIONS.md for project verification, migration review, Auth redirect configuration, Edge Function secrets, GitHub App permissions/webhooks, alert providers and scheduler setup.

Required Edge Function environment variables are listed in supabase/functions/.env.example. That file contains placeholders only. Do not copy real credentials into Git.

## Repository workflow

Work is organized into ordered review branches:
1. Phase 1 — foundation and code quality.
2. Phase 2 — authentication lifecycle.
3. Phase 3 — database security, GitHub monitoring, AI analysis and alerts.
4. Phase 4 — persistent active-workspace context across monitoring pages.

PR #9 (Phase 2) and PR #10 (Phase 3) are merged into their stacked parent branches. PR #8 (Phase 1 → main) remains open. PR #11 (Phase 3 reliability) and PR #12 (Phase 4 workspace context) remain open drafts; PR #12 is stacked on PR #11. Review and integrate the branch chain in dependency order rather than merging a child branch directly to main.

The Phase 4 head `a57e66ccdcea57affa973c73244577682e2ee6cc` passed all three GitHub Actions workflows: Frontend CI, Edge Functions CI and Database Security CI. The production-readiness register tracks the latest verification and outstanding deployment gates.

**Release status: not production ready.** Passing CI is not evidence of live provider configuration, deployed Edge Functions or end-to-end acceptance.
