# Phase 3 — Operations and deployment guide

## Current status

This guide describes the server implementation and the configuration still required to activate external providers. No live Supabase migration, Edge Function deployment, Auth setting, provider secret or production deployment was performed while preparing this branch.

The connected Supabase project inspected during development was healthy, but it could not be proven to be the project referenced by the application because the app environment was placeholder-only. Do not infer a production project from the connected-project name.

## 1. Verify the target Supabase project first

Before deploying:
1. Confirm the exact Supabase project reference and production owner with the project operator.
2. Confirm whether migration 20261112100118_create_team_workspace_foundation is already recorded as applied.
3. Recover the original SQL for that migration, if possible, and compare it with supabase/migrations/20261112100118_create_team_workspace_foundation.sql.
4. Review the incremental migration 20261124144452_secure_workspace_data_plane.sql against the target schema.
5. Test on an isolated development project or a database branch before considering production.

The baseline file is a reconstruction from read-only schema/catalog inspection, not the recovered original source. Its role is to make clean local/test databases reproducible while retaining the already-recorded migration version.

## 2. Supabase Auth configuration

Configure these URLs in the confirmed Supabase project's Auth URL settings:
- Site URL: the deployed browser application's origin.
- Redirect allow-list: the application's /auth/callback route.
- Password recovery redirect: the application's /reset-password route.
- GitHub OAuth callback/provider settings, only if GitHub OAuth login is enabled.

Email confirmation and recovery delivery depend on the Supabase Auth provider and email configuration. They have not been tested against a real inbox from this branch.

## 3. Edge Function secrets

Copy supabase/functions/.env.example to a local, untracked secrets file and populate values in the confirmed target environment. Use the provider's secret manager or the Supabase CLI secret mechanism; do not commit the local file.

Core Supabase:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY — server only, never VITE_
- SUPABASE_PUBLISHABLE_KEYS (JSON object with a default key) or legacy SUPABASE_ANON_KEY
- APP_BASE_URL — exact browser origin, with no trailing path

Security:
- GITHUB_WEBHOOK_SECRET — must exactly match the GitHub App webhook secret
- ALERT_VERIFICATION_PEPPER — long random HMAC key used to hash six-digit verification codes
- ALERT_SCHEDULER_SECRET — at least 32 random characters; use the exact same value in the GitHub Actions repository secret

Providers:
- GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY
- RESEND_API_KEY, EMAIL_FROM
- TELEGRAM_BOT_TOKEN
- AI_API_URL, AI_API_KEY, AI_MODEL

The GitHub private key can be provided as a PKCS#1 RSA PEM or PKCS#8 PEM. The server normalizes PKCS#1 to PKCS#8 before signing the short-lived GitHub App JWT.

## 4. Database migration

Apply migrations only after project identity and baseline drift are confirmed. The automated database CI is isolated PostgreSQL and does not deploy to hosted Supabase.

The incremental migration:
- moves RLS helpers to a non-exposed private schema;
- removes broad anonymous/authenticated grants and tightens future default privileges;
- preserves profile, team and membership data while removing a duplicate profile foreign key;
- protects the final workspace owner;
- adds team-scoped GitHub, workflow, webhook, AI, alert and audit tables;
- grants application writes through trusted Edge Functions except for explicitly permitted narrow browser operations.

Take a database backup and perform a reviewed development migration before production. Do not run a remote push from a developer workstation without the project operator's explicit approval.

## 5. GitHub App setup

Create/configure a GitHub App with only the repository permissions needed by this product:
- Metadata: read
- Actions: read (workflow runs/jobs and logs)
- Contents: read only if required by a later diagnostics expansion; the current log analysis reads Actions logs.

Subscribe to webhook events:
- installation
- installation_repositories
- workflow_run
- workflow_job
- push
- pull_request

Set the webhook URL to:
SUPABASE_URL/functions/v1/github-webhook

Set the App's post-installation setup URL to:
APP_BASE_URL/integrations/github/callback

Store the App ID, slug, downloaded private key and webhook secret only in Edge Function secrets. Verify the event subscription and permissions using a non-production test repository first.

## 6. Email and Telegram

Resend must be configured with a verified sender domain/address before invitation and email alerts can be delivered. Telegram delivery requires a Bot API token and a chat ID that has initiated the bot conversation. Alert channels remain inactive until their six-digit verification code is confirmed.

The verification code is short-lived (10 minutes), stored as an HMAC digest using ALERT_VERIFICATION_PEPPER, and limited to five incorrect attempts.

## 7. AI provider and data handling

AI_API_URL must be a full HTTPS OpenAI-compatible chat-completions URL (for example, a private provider endpoint ending in /chat/completions). AI_MODEL selects the configured model.

Workflow logs may contain proprietary source paths, deployment information or personal data. The implementation bounds archive/entry sizes and redacts common token patterns, but regex redaction is not a guarantee that every secret or personal detail is removed. Review data retention and provider terms before enabling external AI analysis; a self-hosted/private endpoint is preferable for sensitive repositories.

AI output is not a guaranteed root-cause diagnosis and must be checked against the original GitHub run and log evidence.

## 8. Scheduled notifications

The repository contains .github/workflows/scheduled-alert-dispatch.yml, which requests due alert deliveries every five minutes. To activate it:
1. Configure Edge Function secret ALERT_SCHEDULER_SECRET.
2. Add GitHub repository secret SUPABASE_FUNCTIONS_URL, set to the confirmed project's functions base URL ending in /functions/v1.
3. Add GitHub repository secret ALERT_SCHEDULER_SECRET with the identical value used by the Edge Function.
4. Merge the reviewed scheduler workflow to the repository's default branch. Scheduled GitHub Actions events run from the default branch.
5. Trigger workflow_dispatch in a non-production test and verify the returned workspace_count, sent and failed totals.

The scheduler endpoint has no browser token bypass: it requires a separate high-entropy scheduler secret and uses a service-role client server-side. The normal manual endpoint still requires a verified Supabase user and owner/admin membership.

## 9. Post-deployment verification

Run, in order:
- Auth signup, confirmation, password recovery and expiry tests with a controlled test inbox.
- Owner/admin/member workspace access tests using two isolated teams.
- Invitation create, wrong-email rejection, expiry, revoke and one-time acceptance.
- GitHub App install, repository add/remove event reconciliation, webhook signature rejection and duplicate delivery replay.
- Workflow run/job ingestion and cross-team repository isolation.
- AI analysis with a controlled failure log, redaction fixture and daily quota boundary.
- Email/Telegram destination verification and duplicate alert delivery checks.
- Scheduled dispatch in a test environment.

Record the target project reference, migration versions, function deployment versions, provider configuration date, test identities and any remaining limitations before signing off production.
