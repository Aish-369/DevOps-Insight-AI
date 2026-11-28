const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
const unsafeKeyMessage =
  "VITE_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key or a legacy anon key. Never use a service_role or secret key in browser configuration.";

/**
 * Accept modern publishable keys and legacy JWT keys whose role is anon.
 * This is a format/role guard, not cryptographic JWT verification.
 */
export function validateSupabasePublishableKey(value: string): string {
  const key = value.trim();
  if (key.startsWith(PUBLISHABLE_KEY_PREFIX) && key.length > PUBLISHABLE_KEY_PREFIX.length) {
    return key;
  }

  const parts = key.split(".");
  if (parts.length !== 3 || !parts[1]) throw new Error(unsafeKeyMessage);

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const claims: unknown = JSON.parse(atob(padded));
    if (typeof claims !== "object" || claims === null || !("role" in claims) || claims.role !== "anon") {
      throw new Error(unsafeKeyMessage);
    }
  } catch {
    throw new Error(unsafeKeyMessage);
  }

  return key;
}
