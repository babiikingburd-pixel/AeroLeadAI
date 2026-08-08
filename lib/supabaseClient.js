import { createClient } from "@supabase/supabase-js";

let supabase = null;

try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // FIX (verified against a screenshot of the actual Vercel environment
  // variables): only NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set, not
  // NEXT_PUBLIC_SUPABASE_ANON_KEY. This was silently undefined in
  // production the whole time this code only checked the ANON_KEY name —
  // very likely the root cause of the original "Invalid API key" error
  // from early in this project. Supabase's newer sb_publishable_... keys
  // are a drop-in replacement for the legacy anon JWT with this client
  // library version, so checking both names is correct going forward
  // regardless of which one Vercel ends up configured with.
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  }
} catch (e) {
  console.warn("[Supabase] Failed to initialise client — falling back to localStorage:", e.message);
}

export default supabase;
