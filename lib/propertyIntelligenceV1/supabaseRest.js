// Shared server-side Supabase REST helper. Mirrors the direct-fetch pattern
// already used in app/api/permit-lookup/route.js (no supabase-js dependency
// needed server-side — this is lighter and matches what's already working).
//
// Every function returns { ok, data, error } — no throwing, callers decide
// what "not configured" or "failed" should mean for their response.

import { resolveSupabaseServerConfig } from "../supabaseEnvironment";
import { authenticatedSupabaseFetch } from "../supabaseServiceProxy";

export function supabaseConfig() {
  return resolveSupabaseServerConfig();
}

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const { url, key, configured } = supabaseConfig();
  if (!configured) return { ok: false, notConfigured: true, error: "The secure database gateway is not configured." };

  try {
    const res = await authenticatedSupabaseFetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Prefer: method === "POST" ? "return=representation,resolution=merge-duplicates" : "return=representation",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Supabase HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    // Some PATCH/DELETE calls with Prefer: return=minimal come back empty.
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export const supabaseGet = (path) => rest(path, { method: "GET" });
export const supabasePost = (path, body, opts = {}) => rest(path, { method: "POST", body, ...opts });
export const supabasePatch = (path, body) => rest(path, { method: "PATCH", body, headers: { Prefer: "return=representation" } });

export function normalizeAddress(address) {
  return (address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
