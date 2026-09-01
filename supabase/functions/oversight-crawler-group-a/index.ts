import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://aero-lead-ai.vercel.app";
const db = createClient(PROJECT_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
async function sha256(value: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }

Deno.serve(async () => {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const { error } = await db.from("oversight_pulse_tokens").insert({ token_hash: tokenHash, expires_at: new Date(Date.now() + 5 * 60_000).toISOString() });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const response = await fetch(`${APP_URL}/api/oversight/crawlers/A`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-oversight-pulse-token": token },
    body: JSON.stringify({ source: "supabase-crawler-group-a" }),
    signal: AbortSignal.timeout(110_000),
  });
  const body = await response.json().catch(() => ({}));
  return Response.json(body, { status: response.status });
});
