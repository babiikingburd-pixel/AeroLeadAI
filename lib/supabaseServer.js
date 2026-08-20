import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client. There is deliberately no anon/publishable-key
// fallback: internal API routes must fail closed instead of accidentally
// depending on a public database grant when the service credential is absent.
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
