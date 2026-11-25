import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

const REQUEST_LIMIT = 60;
const WINDOW_SECONDS = 60;

export async function rateLimitKeyHash(
  userId: string,
  endpoint: string,
): Promise<string> {
  const value = new TextEncoder().encode(userId + "\n" + endpoint);
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Apply an atomic, database-backed per-user/per-function fixed-window limit.
 * Fail closed if the shared limiter cannot be reached; an unavailable guard
 * must not silently turn every Edge Function instance into an unlimited one.
 */
export async function enforceUserRateLimit(
  admin: SupabaseClient,
  request: Request,
  userId: string,
): Promise<void> {
  const endpoint = new URL(request.url).pathname.split("/").filter(Boolean)
    .at(-1) ?? "unknown";
  const keyHash = await rateLimitKeyHash(userId, endpoint);
  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    p_key_hash: keyHash,
    p_limit: REQUEST_LIMIT,
    p_window_seconds: WINDOW_SECONDS,
  });

  if (error) {
    console.error("Shared API rate limiter unavailable", {
      code: error.code,
    });
    throw new HttpError(
      503,
      "RATE_LIMITER_UNAVAILABLE",
      "This service is temporarily unavailable. Please try again shortly.",
    );
  }
  if (data !== true) {
    throw new HttpError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Please wait one minute and try again.",
    );
  }
}
