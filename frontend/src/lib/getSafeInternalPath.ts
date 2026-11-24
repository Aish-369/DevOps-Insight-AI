const ALLOWED_AUTH_DESTINATIONS = new Set([
  "/dashboard",
  "/repositories",
  "/pipelines",
  "/activity",
  "/teams",
  "/settings/account",
  "/reset-password",
]);

/**
 * Accept only known same-origin application routes for post-auth navigation.
 * This prevents an untrusted query parameter from becoming an open redirect.
 */
export function getSafeInternalPath(
  candidate: string | null | undefined,
  origin: string,
  fallback = "/dashboard",
): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, origin);
    if (parsed.origin !== origin || !ALLOWED_AUTH_DESTINATIONS.has(parsed.pathname)) {
      return fallback;
    }
    return parsed.pathname + parsed.search;
  } catch {
    return fallback;
  }
}
