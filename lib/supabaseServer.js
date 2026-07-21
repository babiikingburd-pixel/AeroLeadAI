// Minimal server-side Supabase REST helper — same raw-fetch-to-PostgREST
// pattern already used in app/api/permit-lookup/route.js, rather than
// pulling in @supabase/supabase-js on the server for a handful of calls.
// Requires SUPABASE_SERVICE_ROLE_KEY (bypasses RLS) since the autonomous
// scanner writes to tables that intentionally have no anon write policy.

export function supabaseAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { url, key, configured: !!(url && key) };
}

function headers(key, extra) {
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extra };
}

export async function sbSelect(table, queryString) {
  const { url, key, configured } = supabaseAdminConfig();
  if (!configured) throw new Error("Supabase not configured (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}?${queryString}`, { headers: headers(key) });
  if (!res.ok) throw new Error(`Supabase select ${table} failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function sbInsert(table, rows) {
  const { url, key, configured } = supabaseAdminConfig();
  if (!configured) throw new Error("Supabase not configured (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(key, { Prefer: "return=minimal" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(`Supabase insert ${table} failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
}

export async function sbUpsert(table, rows, onConflict) {
  const { url, key, configured } = supabaseAdminConfig();
  if (!configured) throw new Error("Supabase not configured (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: headers(key, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
  });
  if (!res.ok) throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
}

export async function sbUpdate(table, filterQuery, patch) {
  const { url, key, configured } = supabaseAdminConfig();
  if (!configured) throw new Error("Supabase not configured (need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).");
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}?${filterQuery}`, {
    method: "PATCH",
    headers: headers(key, { Prefer: "return=minimal" }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Supabase update ${table} failed: HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
}
