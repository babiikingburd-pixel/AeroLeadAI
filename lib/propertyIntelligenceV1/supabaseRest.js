// Shared server-side Supabase REST helper. Mirrors the direct-fetch pattern
// already used in app/api/permit-lookup/route.js (no supabase-js dependency
// needed server-side — this is lighter and matches what's already working).
//
// Every function returns { ok, data, error } — no throwing, callers decide
// what "not configured" or "failed" should mean for their response.

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return { url: url ? url.replace(/\/$/, "") : null, key, configured: !!(url && key) };
}

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const { url, key, configured } = supabaseConfig();
  if (!configured) return { ok: false, notConfigured: true, error: "Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)." };

  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
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
