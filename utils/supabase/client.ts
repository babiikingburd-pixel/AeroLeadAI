import { createBrowserClient } from "@supabase/ssr";

// Browser-safe client. Only ever uses NEXT_PUBLIC_* vars — the anon key,
// which is subject to RLS. batch_leads has anon SELECT but no anon write,
// so any write attempted from this client will be rejected by RLS, which
// is the intended behavior (writes go through app/api/* server routes).

const supabaseUrl = "https://jxpjxvfhedyroonnwjqm.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4cGp4dmZoZWR5cm9vbm53anFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzk4OTQsImV4cCI6MjEwMjY1NTg5NH0.z8tNvnyoa_bzpVoOJaspY6njLAwYt7hNrQRMMqc-uS0";

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseAnonKey);
