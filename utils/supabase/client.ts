import { createBrowserClient } from "@supabase/ssr";

// Browser-safe client. Only ever uses NEXT_PUBLIC_* vars — the anon key,
// which is subject to RLS. batch_leads has anon SELECT but no anon write,
// so any write attempted from this client will be rejected by RLS, which
// is the intended behavior (writes go through app/api/* server routes).

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const createClient = () =>
  createBrowserClient(supabaseUrl, supabaseAnonKey);
