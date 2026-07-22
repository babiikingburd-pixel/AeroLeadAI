import { createClient } from "@supabase/supabase-js";

let supabase = null;

try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
  }
} catch (e) {
  console.warn("[Supabase] Failed to initialise client — falling back to localStorage:", e.message);
}

export default supabase;
