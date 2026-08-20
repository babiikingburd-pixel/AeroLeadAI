// The secure clean project intentionally exposes no browser-readable tables.
// Components poll owner-authenticated API routes; legacy local workflows keep
// their existing localStorage fallback rather than emitting invalid-key/RLS
// errors from stale public Vercel variables.
export const isSupabaseConfigured = false;
export const supabase = null;

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

// Property imagery is private. Browser code must upload through /api/upload,
// which applies owner authentication and returns a short-lived signed URL.
export async function uploadImageToDB() {
  throw new Error("Direct browser storage uploads are disabled. Use /api/upload.");
}
