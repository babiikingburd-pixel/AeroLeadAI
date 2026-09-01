import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const PROJECT_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://aero-lead-ai.vercel.app";

const db = createClient(PROJECT_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

Deno.serve(async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const token = hex(raw);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

  const { error: tokenError } = await db.from("oversight_pulse_tokens").insert({
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (tokenError) return Response.json({ ok: false, error: tokenError.message }, { status: 500 });

  try {
    const response = await fetch(`${APP_URL}/api/cron/oversight-discovery`, {
      method: "GET",
      headers: { "x-oversight-pulse-token": token },
      signal: AbortSignal.timeout(55_000),
    });
    const body = await response.json().catch(() => ({}));
    await db.from("oversight_pulse_tokens").delete().eq("token_hash", tokenHash);
    return Response.json({ ok: response.ok, status: response.status, discovery: body }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    await db.from("oversight_pulse_tokens").delete().eq("token_hash", tokenHash);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
