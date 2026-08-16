import { createClient } from "@supabase/supabase-js";

// Fallback placeholders let the app build even before real credentials are
// set. At runtime you MUST set the real values in .env.local (dev) or your
// hosting provider's environment variables (production), or auth/storage
// calls will fail.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
