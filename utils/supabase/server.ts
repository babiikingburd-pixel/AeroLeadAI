import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// SECURITY: this file is server-only. It reads SUPABASE_SERVICE_ROLE_KEY,
// which must NEVER be prefixed with NEXT_PUBLIC_ or referenced from any
// file under app/**/page.tsx client components. RLS is bypassed by the
// service role — every write path using this client must validate input
// and authorize the caller itself (see lib/auth.ts).

export const createServiceClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase server env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  return createServerClient(supabaseUrl, serviceRoleKey, {
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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Missing Supabase server env vars: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

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
