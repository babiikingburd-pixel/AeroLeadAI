// Shared server-side Supabase REST helper for the autonomy loops. Same
// direct-fetch pattern already used elsewhere in the app (no supabase-js
// dependency needed server-side).

import { resolveSupabaseServerConfig } from "./supabaseEnvironment";

export function supabaseConfig() {
  return resolveSupabaseServerConfig();
}

export async function supabaseGet(path) {
  const { url, key, configured } = supabaseConfig();
  if (!configured) return { ok: false, notConfigured: true, data: [] };
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, data: [] };
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, error: e.message, data: [] };
  }
}

export async function supabasePost(path, body, prefer = "return=representation") {
  const { url, key, configured } = supabaseConfig();
  if (!configured) return { ok: false, notConfigured: true };
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: prefer },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true, data: prefer.includes("representation") ? await res.json() : null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function supabasePatch(path, body) {
  const { url, key, configured } = supabaseConfig();
  if (!configured) return { ok: false, notConfigured: true };
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: "PATCH",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function supabaseDelete(path) {
  const { url, key, configured } = supabaseConfig();
  if (!configured) return { ok: false, notConfigured: true };
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function normalizeAddress(address) {
  return (address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
