import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client for Phase 2 / Executive Engine API routes —
// prefers the service role key (bypasses RLS, used server-side only, never
// exposed to the browser) and falls back to the anon key, same precedence
// as permit-lookup.js. Returns null (not a throw) when unconfigured so
// every caller can degrade gracefully instead of crashing the route.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
