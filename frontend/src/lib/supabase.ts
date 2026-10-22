import { createClient } from "@supabase/supabase-js";

// Read Supabase settings from the environment file.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Check that the required settings exist.
if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase settings are missing. Check .env.local");
}

// Create and export the Supabase client.
export const supabase = createClient(supabaseUrl, supabaseKey);