# Phase 3 — Operations and deployment guide

**Confirmed Supabase target:** `mtrmvvtobbbjusiteyvp`  
**Current state (2026-11-28):** Seven migrations listed below are applied and verified. The Supabase project is ACTIVE_HEALTHY and currently has zero Edge Functions deployed. The Vercel frontend is live at `https://dev-ops-insight-ai.vercel.app` (verified production domain). No paid Supabase development branch was created.

## 1. Database state — already applied

The target project's migration history is:

- `20261112100118_create_team_workspace_foundation`
- `20261125111227_secure_workspace_data_plane`
- `20261125111400_index_phase3_foreign_keys`
- `20261125111523_restrict_sensitive_workspace_columns`
- `20261125111715_deny_client_access_to_internal_tables`
- `20261125134153_reliable_event_delivery`
- `20261125134241_index_workflow_run_attempts_fk`

Do not re-run these migrations. The four original incremental migrations were applied after a successful transaction/rollback validation. Workspace row counts for teams, members, invitations and projects were zero before and after. No database backup was created during this session; the migration set was additive/security-focused, and the existing workspace tables contained no rows at the time of application.

The canonical repository migration `20261125134153_reliable_event_delivery.sql` is aligned with the hosted migration history and is applied and verified. The older `20261125112000_reliable_event_delivery.sql` path is retained as a documented no-op to prevent duplicate DDL on fresh databases. The follow-up migration `20261125134241_index_workflow_run_attempts_fk.sql` adds the missing composite index for the attempt-history foreign key. The hosted project currently has zero workflow runs and zero alert rows, so the reliability migration's legacy `processing`-alert transition did not alter existing alert data.


The original source for the pre-existing workspace foundation migration was unavailable. Its repository SQL is a reconstruction from the live catalog, not recovered original source. Do not use that reconstructed baseline to overwrite an existing database.

## 2. Supabase Auth settings

Configure the confirmed project's Auth URL settings after the frontend production origin is known:

- Site URL: `https://dev-ops-insight-ai.vercel.app`.
- Redirect allow-list: `https://dev-ops-insight-ai.vercel.app/auth/callback` (plus only the required local development callback URLs).
- Password minimum length: use at least 8 characters and enable the strongest character requirements available on the plan.

**Free-plan limitation:** Supabase's leaked-password protection (HaveIBeenPwned check) is Pro-and-above only. The Security Advisor warning will remain on Free; there is no free-plan workaround. See the [Supabase password security documentation](https://supabase.com/docs/guides/auth/password-security).

## 3. Edge Function secrets — required before deployment

The code uses Supabase's automatically injected project URL and API keys. The current shared auth helper supports the current `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` dictionaries, with legacy key fallbacks.

Set the following project-level values in **Supabase Dashboard → Edge Functions → Secrets**. Do not paste secret values into chat or commit them to GitHub. Supabase's official guide: https://supabase.com/docs/guides/functions/secrets

| Name | Purpose |
|---|---|
| `APP_BASE_URL` | Exact HTTPS origin of the deployed frontend; used for CORS and invitation URLs |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_SLUG` | GitHub App slug |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private PEM key |
| `GITHUB_WEBHOOK_SECRET` | Must match the GitHub App webhook secret |
| `ALERT_VERIFICATION_PEPPER` | Long random HMAC pepper for alert-channel verification |
| `ALERT_SCHEDULER_SECRET` | At least 32 random characters; also add the identical value as a GitHub Actions repository secret |
| `RESEND_API_KEY` | Email provider credential |
| `EMAIL_FROM` | Verified sender address/domain for Resend |
| `TELEGRAM_BOT_TOKEN` | Telegram bot credential (only if Telegram alerts are enabled) |
| *(none)* | CI diagnostics use local deterministic rules; no AI provider secret is required |

Only set provider credentials for providers the product will actually use. Resend/Telegram/AI providers may have their own free quotas and limits; confirm those separately. Supabase Edge Function secrets are not Vite variables.

## 3A. Zero-cost CI failure analysis

**Non-negotiable budget: ₹0 / $0.** The current implementation uses deterministic, in-process log signatures (rules-v1) inside the Supabase Edge Function. It does not call OpenAI, Vercel AI Gateway, Hugging Face, or any other hosted model. It requires no AI API key, payment method, autopay, credits, or billing setup.

What it does:
- Detects a bounded set of recognizable signatures such as npm dependency conflicts, missing modules, TypeScript diagnostics, lint failures, test failures, permission errors, network failures and Docker build errors.
- Returns a cause and suggested next steps only when a known signature is present.
- Includes an exact excerpt from the already-redacted workflow logs as evidence.
- Uses medium confidence for a matched rule and low confidence with no asserted root cause when no rule matches.
- Stores the analyzer identity as rules-v1; it must not be represented in the UI or reports as an LLM-generated answer.

Important limitations:
- This is deterministic diagnostics, **not generative AI**. It cannot understand arbitrary logs or reason beyond the implemented signatures.
- A low-confidence/unknown result requires human investigation. Do not invent causes or claim AI reasoning.
- The existing per-team daily analysis allowance remains as an abuse/cost-control limit even though this analyzer makes no model API calls.
- Any future model integration is out of scope until it can be demonstrated to remain strictly free with no payment method, no autopay and no paid fallback. Do not add credentials or enable billing.

## 3B. Zero-cost operating policy

- Keep Supabase and Vercel on their existing Free/Hobby plans. Do not create paid branches, upgrade plans, enable paid compute or deploy paid add-ons.
- Use only GitHub Free capabilities and free-tier provider options where no payment method is required.
- Email/Telegram delivery is optional. If a provider requires a card, paid plan or billable usage, leave that channel disabled; do not silently substitute a paid provider.
- When a free quota or platform limit is reached, stop or defer the affected operation and show a clear unavailable/limit state. Never trigger a paid fallback.
- Do not create AI Gateway keys, paid model keys, credits, billing budgets, payment methods or autopay.

## 4. Frontend and scheduler configuration

- The Vercel production project already has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured for production and preview. Keep service-role/secret keys out of all `VITE_` variables.
- Verified frontend production origin: `https://dev-ops-insight-ai.vercel.app` (verified Vercel domain). Set `APP_BASE_URL` to this exact origin in Supabase Edge Function secrets. Without it, browser requests from the deployed origin are rejected by CORS.
- For the scheduled alert workflow, add GitHub repository secrets `SUPABASE_FUNCTIONS_URL` (`https://mtrmvvtobbbjusiteyvp.supabase.co/functions/v1`) and `ALERT_SCHEDULER_SECRET` (identical to the Supabase function secret). Confirm both names are present without printing secret values.
- Configure and verify Supabase Auth Site URL and redirect allow-list using the deployed frontend origin and `/auth/callback` route.

## 5. Function deployment and verification

The target currently has zero deployed Edge Functions. The Vercel frontend is deployed, but deploy the version-controlled functions only after all required secrets are safely configured and the exact Auth redirect settings are verified. The function config intentionally sets `verify_jwt = false`; every user-facing function performs its own Supabase user authentication and team-role checks, while the GitHub webhook validates the raw-body HMAC signature and the scheduler uses its independent secret. Do not change those checks or expose service credentials in the browser.

### Reliability behavior to understand before operating

- Authenticated Edge Function requests are limited to 60 requests per user/function per minute. A rate-limit database failure returns 503 (fail-closed); a limit breach returns 429. GitHub webhook requests use HMAC verification and delivery deduplication; scheduled dispatch uses the separate scheduler secret.
- A workflow job arriving before its parent run is stored as normalized pending data and reconciled when the parent run arrives. Pending records expire after seven days; inspect the webhook event history if a job remains absent.
- With `skip_flaky` enabled, a failed attempt followed by a successful latest retry is classified as flaky. Failure alerts wait 10 minutes before dispatch so an immediate rerun can suppress them. An alert already sent cannot be recalled.
- Alert rows move from `processing` to `sending` immediately before contacting a provider. A stale `sending` row becomes `delivery_unknown`; it is deliberately excluded from automatic retries. Check provider delivery logs before deciding whether to resend. Do not blindly reset an unknown Telegram delivery to pending because Telegram does not provide a general idempotency key.

After deployment, verify:
- User-authenticated team/invitation/member operations with owner, admin and member accounts.
- GitHub App installation, repository sync and webhook signature rejection/acceptance using a non-production repository.
- Alert-channel verification and email/Telegram delivery only for configured providers.
- AI analysis and daily quota enforcement only after configuring an approved AI endpoint.
- Scheduler authentication with a valid and invalid secret.
- Auth signup, email confirmation, password recovery and redirect allow-list with a controlled test inbox.

Do not mark production readiness until these live integration checks pass and the final GitHub Actions runs are green.
