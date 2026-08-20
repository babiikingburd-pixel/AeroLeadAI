import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const supabaseUrl = "https://jxpjxvfhedyroonnwjqm.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4cGp4dmZoZWR5cm9vbm53anFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzk4OTQsImV4cCI6MjEwMjY1NTg5NH0.z8tNvnyoa_bzpVoOJaspY6njLAwYt7hNrQRMMqc-uS0";

export const updateSession = async (request: NextRequest) => {
  let supabaseResponse = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // touches the session so expiring tokens get refreshed
  await supabase.auth.getUser();

  return supabaseResponse;
};
