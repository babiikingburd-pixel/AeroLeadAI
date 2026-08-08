import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client for Phase 2 / Executive Engine API routes —
// prefers the service role key (bypasses RLS, used server-side only, never
// exposed to the browser) and falls back through every key-name variant
// actually seen in this project's real Vercel environment (confirmed via
// screenshot: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, and
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are what's actually set —
// NEXT_PUBLIC_SUPABASE_ANON_KEY is NOT, despite older code assuming it
// was). Returns null (not a throw) when unconfigured so every caller can
// degrade gracefully instead of crashing the route.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
