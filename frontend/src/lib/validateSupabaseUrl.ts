/** Validate a Supabase URL before exposing it to the browser client. */
export function validateSupabaseUrl(value: string): string {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw new Error("VITE_SUPABASE_URL must be a valid absolute URL. Check frontend/.env.local.");
  }

  if (
    (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error("VITE_SUPABASE_URL must use HTTP(S), include a hostname, and must not contain credentials, query parameters, or a fragment.");
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname.toLowerCase());
  if (parsedUrl.protocol === "http:" && !loopback) {
    throw new Error("VITE_SUPABASE_URL must use HTTPS outside localhost development environments.");
  }

  return parsedUrl.toString().replace(/\/$/, "");
}
