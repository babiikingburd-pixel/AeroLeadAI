import { createClient } from "@supabase/supabase-js";
import { resolveSupabaseServerConfig } from "./supabaseEnvironment";
import { AEROLEAD_EDGE_INVOKE_KEY, authenticatedSupabaseFetch } from "./supabaseServiceProxy";

// Server-only Supabase client. There is deliberately no anon/publishable-key
// fallback: internal API routes must fail closed instead of accidentally
// depending on a public database grant when the service credential is absent.
export function supabaseServer() {
  const { url, key, configured } = resolveSupabaseServerConfig();
  if (!configured) return null;
  return createClient(url, key || AEROLEAD_EDGE_INVOKE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: authenticatedSupabaseFetch },
  });
}
