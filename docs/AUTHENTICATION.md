# Authentication lifecycle — implementation and provider configuration

## Implemented in this phase branch

- Explicit Supabase PKCE browser flow with session persistence, refresh and callback URL detection.
- Signup confirmation redirect to `/auth/callback`.
- GitHub OAuth redirect to the same callback route.
- Callback handler that asks Supabase to initialize/exchange the PKCE code, verifies the resulting user through `getUser()`, and only navigates to allow-listed same-origin app routes.
- Forgot-password request using `resetPasswordForEmail()`, with a same-origin `/reset-password` redirect and non-enumerating success copy.
- Password recovery route that only exposes the update form after a `PASSWORD_RECOVERY` event with a session; expired or ordinary signed-in sessions do not gain recovery UI.
- Password update using `updateUser({ password })`.
- Account settings to request an email change and change the current account password.
- Dashboard account settings navigation.
- Logout request errors are handled without falsely navigating away.
- Duplicate-signup errors are mapped to generic copy to reduce account enumeration.
- Signup, recovery and account-password forms apply a 12-character client-side minimum; the Supabase Auth policy must be configured to enforce the same or stronger rule server-side.

## Supabase Auth dashboard configuration still required

Do not set these values until the final app domain is known and the correct project has been confirmed against the local/production environment configuration.

In Supabase Dashboard → Authentication → URL Configuration:

1. Set **Site URL** to the exact production frontend origin.
2. Add exact redirect URLs for local development and production:
   - `http://localhost:5173/auth/callback`
   - `http://127.0.0.1:5173/auth/callback`
   - `http://localhost:5173/reset-password`
   - `http://127.0.0.1:5173/reset-password`
   - `https://YOUR_PRODUCTION_HOST/auth/callback`
   - `https://YOUR_PRODUCTION_HOST/reset-password`
3. Replace `YOUR_PRODUCTION_HOST` with the verified deployed hostname. Do not add broad wildcard redirect entries unless there is a documented need.
4. Set the Supabase Auth minimum password length to at least 12 characters (or a stronger chosen policy) so the server enforces the same rule; frontend validation is not a security boundary.

For GitHub sign-in, configure the GitHub OAuth provider in Supabase Auth. The provider's callback URL is the Supabase Auth callback URL shown by the Supabase provider settings (not this frontend's `/auth/callback` path). Do not put GitHub OAuth client secrets in Vite environment variables.

For production email delivery, configure a verified SMTP provider and sender domain in Supabase Auth. Supabase's built-in test email delivery is not a production email service. Test confirmation and recovery messages using dedicated controlled test accounts and real inboxes.

## Required live-provider verification before production

- New signup receives confirmation instructions and the confirmation link completes PKCE exchange.
- An existing email signup does not leak account existence through app-specific messages.
- GitHub OAuth completes on the configured provider and returns to the safe callback.
- A recovery email is actually delivered.
- Recovery link establishes a `PASSWORD_RECOVERY` session and permits password update.
- Expired/replayed recovery links cannot change passwords.
- Change-email flow follows the project's actual email confirmation settings.
- Session expires/revokes and protected routes return to sign-in.
- Logout invalidates the current local session.

These real provider checks are not claimed as passed by the mocked Playwright suite. They require the actual SMTP/provider settings and controlled test inboxes.


## Automated tests

The latest passing GitHub Actions run is documented in [Phase 2 verification](./phase-2-authentication.md). Playwright tests mock the Supabase Auth HTTP boundary and verify frontend redirects, validation and failure states. They do not verify provider credentials or inbox delivery.
