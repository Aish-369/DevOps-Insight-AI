import { createClient } from "@supabase/supabase-js";

// Read the Supabase project URL from the environment variables.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

// Read the public publishable key from the environment variables.
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Check that the required configuration is available.
if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Supabase configuration is missing. Check your .env.local file."
  );
}

// Create and export the Supabase client.
export const supabase = createClient(supabaseUrl, supabaseKey);