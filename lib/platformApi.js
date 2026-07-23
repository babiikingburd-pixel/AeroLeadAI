import crypto from "crypto";
import { supabaseServer } from "./supabaseServer";

/**
 * #16 Developer & Integration Platform
 *
 * Issues scoped API keys for third parties (an insurer checking claim
 * status, a property manager's own software pulling reports), verifies
 * them on public API routes, and dispatches outbound webhooks when key
 * platform events occur (job completed, quality flag raised) so
 * integrators don't have to poll.
 */

export const PUBLIC_API_SCOPES = ["leads:read", "jobs:read", "properties:read", "contractors:read", "webhooks:manage"];

export async function createApiKey({ organizationId, label, scopes }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const rawKey = `alai_${crypto.randomBytes(24).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

  const { error } = await supabase.from("api_keys").insert({ organization_id: organizationId, label, key_hash: hash, scopes, active: true });
  if (error) throw new Error(`API key creation failed: ${error.message}`);

  // The raw key is returned ONLY here — it's never stored or shown again, same pattern as Stripe/GitHub.
  return { api_key: rawKey };
}

export async function verifyApiKey(rawKey, requiredScope) {
  const supabase = supabaseServer();
  if (!supabase) return { valid: false, reason: "Supabase not configured." };
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const { data: key } = await supabase.from("api_keys").select("*").eq("key_hash", hash).eq("active", true).maybeSingle();
  if (!key) return { valid: false, reason: "Invalid or revoked key" };
  if (requiredScope && !(key.scopes || []).includes(requiredScope)) return { valid: false, reason: `Key lacks scope "${requiredScope}"` };
  return { valid: true, organizationId: key.organization_id, scopes: key.scopes };
}

export async function revokeApiKey(keyId) {
  const supabase = supabaseServer();
  if (!supabase) return;
  await supabase.from("api_keys").update({ active: false }).eq("id", keyId);
}

export async function registerWebhook({ organizationId, url, events }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase.from("webhook_subscriptions").insert({ organization_id: organizationId, url, events, active: true }).select().single();
  if (error) throw new Error(`Webhook registration failed: ${error.message}`);
  return data;
}

/** Fire an event to every subscribed webhook — call from wherever the event actually happens. */
export async function dispatchEvent(eventType, payload) {
  const supabase = supabaseServer();
  if (!supabase) return [];
  const { data: subs } = await supabase.from("webhook_subscriptions").select("*").eq("active", true).contains("events", [eventType]);

  const results = [];
  for (const sub of subs || []) {
    try {
      const signature = crypto.createHmac("sha256", process.env.WEBHOOK_SIGNING_SECRET || "dev-secret").update(JSON.stringify(payload)).digest("hex");
      const res = await fetch(sub.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AeroLeadAI-Signature": signature },
        body: JSON.stringify({ event: eventType, data: payload, sent_at: new Date().toISOString() }),
      });
      results.push({ url: sub.url, status: res.status });
    } catch (err) {
      results.push({ url: sub.url, error: err.message });
    }
  }
  return results;
}
