import { createClient } from "@supabase/supabase-js";

// Browser client — safe to import from client components.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// FIX: Vercel has NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set, not
// NEXT_PUBLIC_SUPABASE_ANON_KEY (confirmed via the actual environment
// variables list) — check both names, same reasoning as supabaseClient.js.
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Server client — service role key, API routes only. Never import this
// file's `supabaseAdmin` export from a client component.
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const LOCAL_KEY = "aeroleadai_leads_v1";

function localStorageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadLocalLeads() {
  if (!localStorageAvailable()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalLeads(leads) {
  if (!localStorageAvailable()) return leads;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(leads));
  } catch {}
  return leads;
}

// Saves a lead to Supabase when configured, otherwise falls back to
// localStorage so the app keeps working without any keys set.
export async function saveLeadToDB(lead) {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("leads").insert([lead]).select();
    if (error) throw error;
    return data?.[0] ?? lead;
  }
  const leads = loadLocalLeads();
  const record = { id: lead.id || Math.random().toString(36).slice(2), created_at: new Date().toISOString(), ...lead };
  leads.unshift(record);
  saveLocalLeads(leads);
  return record;
}

// Reads the most recent leads, newest first.
export async function getLeadsFromDB(limit = 50) {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  }
  return loadLocalLeads().slice(0, limit);
}

// Uploads a file to the property-images bucket. `file` is a File/Blob
// (browser) or a Buffer with contentType (server). Returns the public URL,
// or null when Supabase storage isn't configured.
export async function uploadImageToDB(file, path) {
  const client = supabase || supabaseAdmin;
  if (!isSupabaseConfigured && !supabaseAdmin) return null;
  const { error } = await (client || supabaseAdmin).storage
    .from("property-images")
    .upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = (client || supabaseAdmin).storage.from("property-images").getPublicUrl(path);
  return data?.publicUrl ?? null;
}
