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

### GitHub integration and monitoring
- GitHub App installation flow bound to an authenticated workspace admin through a short-lived one-time state token.
- Installation metadata and repository sync using short-lived GitHub installation tokens.
- Signed GitHub webhook endpoint. It verifies the raw request body with HMAC-SHA256, rejects duplicate delivery IDs, records only a payload digest (not the raw payload), and reconciles installation, repository, workflow-run, job, push and pull-request events.
- Team-scoped workflow history and links to the corresponding GitHub Actions run.

### AI failure analysis
- Authenticated team members can request analysis of completed unsuccessful workflow runs.
- Logs are size-bounded and common credential patterns are redacted before they are sent to the configured OpenAI-compatible chat-completions endpoint.
- Results are stored with evidence, proposed next steps, model/prompt version and a confidence label.
- Daily usage is reserved by an atomic PostgreSQL function and capped per team.
- AI output is an assistive hypothesis. It does not apply code changes automatically and must be reviewed against the original logs.

### Alerts
- Email and Telegram destinations require a verification code before they can receive alerts.
- Alert rules support branch filters and recovery notifications.
- Delivery records use deduplication keys, atomic processing claims, bounded retries and a manual dispatch action.
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

- The Supabase project inspected during development could not be conclusively mapped to the application because the frontend environment template is placeholder-only.
- No migration has been applied to the connected Supabase project from this work.
- No Edge Function has been deployed and no Auth provider, GitHub App, email, Telegram, AI or scheduler secret has been configured.
- Sending invitations, alerts, GitHub webhooks and AI analysis therefore requires the setup in the Phase 3 operations guide.
- The original SQL source for the already-applied workspace foundation migration was absent from the repository. The file 20261112100118_create_team_workspace_foundation.sql is a documented reconstruction from read-only catalog inspection. Review it against the original source before using it for a new database.
- skip_flaky is currently a stored preference column; automatic flaky-run classification is not implemented in this branch.

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

Database CI runs PostgreSQL 17.11 in an isolated GitHub Actions service container. It creates test-only Supabase Auth primitives, applies the reconstructed workspace baseline and all four incremental migrations, then tests RLS/privileges, sensitive-column access, foreign-key indexes, cross-team isolation, owner invariants, cascade behavior and atomic AI quota. It does not connect to or modify the hosted Supabase project.

## Supabase and provider setup

Follow docs/PHASE-3-OPERATIONS.md for project verification, migration review, Auth redirect configuration, Edge Function secrets, GitHub App permissions/webhooks, alert providers and scheduler setup.

Required Edge Function environment variables are listed in supabase/functions/.env.example. That file contains placeholders only. Do not copy real credentials into Git.

## Repository workflow

Work is organized into ordered review branches:
1. Phase 1 — foundation and code quality.
2. Phase 2 — authentication lifecycle.
3. Phase 3 — database security and platform backend.

The Phase 3 branch is intended to target the Phase 2 branch. Review and merge the phases in order; do not merge Phase 3 directly to main ahead of its dependencies.
