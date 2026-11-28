import { validateSupabasePublishableKey } from "./validateSupabasePublishableKey";
import { validateSupabaseUrl } from "./validateSupabaseUrl";

function requireValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Missing required environment variable: ${name}. Copy frontend/.env.example to frontend/.env.local and provide the value.`);
  }
  return normalized;
}

export const appEnv = Object.freeze({
  supabaseUrl: validateSupabaseUrl(requireValue("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL)),
  supabasePublishableKey: validateSupabasePublishableKey(requireValue("VITE_SUPABASE_PUBLISHABLE_KEY", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)),
});
