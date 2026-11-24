import { createClient } from "@supabase/supabase-js";
import { appEnv } from "./env";

// Browser client only: use a publishable/legacy anon key.
// All row-level authorization must be enforced by PostgreSQL RLS.
export const supabase = createClient(appEnv.supabaseUrl, appEnv.supabasePublishableKey);
