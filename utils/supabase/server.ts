import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveSupabaseServerConfig } from "../../lib/supabaseEnvironment";
import { AEROLEAD_EDGE_INVOKE_KEY, authenticatedSupabaseFetch } from "../../lib/supabaseServiceProxy";

// SECURITY: this file is server-only. It reads a Supabase secret/service key,
// which must NEVER be prefixed with NEXT_PUBLIC_ or referenced from any
// file under app/**/page.tsx client components. RLS is bypassed by the
// service role — every write path using this client must validate input
// and authorize the caller itself (see lib/auth.ts).

export const createServiceClient = () => {
  const { url: supabaseUrl, key: serviceRoleKey, configured } = resolveSupabaseServerConfig();

  if (!configured || !serviceRoleKey) {
    throw new Error(
      "No clean-project Supabase secret/service-role credential is configured"
    );
  }

  return createServerClient(supabaseUrl, serviceRoleKey || AEROLEAD_EDGE_INVOKE_KEY, {
    global: { fetch: authenticatedSupabaseFetch },
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // service-role client is stateless — no session cookies to persist
      },
    },
  });
};

// Session-aware client for authenticated user routes (uses anon key + cookies)
export const createClient = async () => {
  const { url: supabaseUrl } = resolveSupabaseServerConfig();
  const anonKey = AEROLEAD_EDGE_INVOKE_KEY;

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // called from a Server Component with no writable cookie store —
          // safe to ignore as long as middleware.ts is refreshing sessions
        }
      },
    },
  });
};
