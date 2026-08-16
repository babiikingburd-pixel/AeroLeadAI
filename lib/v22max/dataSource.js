/**
 * AeroLeadAI v2.2 MAX — Data Source (ADDITIVE, safe).
 *
 * Reuses the EXISTING Supabase client from lib/supabase.js when it is
 * configured. When it is not, returns clearly-labelled DEMO data so every
 * v2.2 MAX route works with zero keys — and never presents demo data as live.
 *
 * Does not modify or re-implement the existing client; it imports it. Does not
 * call the GateKeeper service.
 */

import { supabase, supabaseAdmin, isSupabaseConfigured } from "../supabase.js";

const DEMO_LEADS = [
  { id:"demo-1", address:"1420 Maple Ridge Dr, Minneapolis, MN", priority_score:88, evidence_score:74, confidence_score:81, validation_score:66, roof_visual_score:79, assessed_value:412000, storm_evidence:{type:"hail",severity:"severe",date:"2026-06-14"}, created_at:"2026-06-20T00:00:00Z", updated_at:"2026-07-28T00:00:00Z" },
  { id:"demo-2", address:"88 Birchwood Ln, Edina, MN", priority_score:71, evidence_score:55, confidence_score:62, validation_score:48, roof_visual_score:51, assessed_value:655000, storm_evidence:{type:"wind",severity:"moderate",date:"2026-05-02"}, created_at:"2026-05-05T00:00:00Z", updated_at:"2026-05-30T00:00:00Z" },
  { id:"demo-3", address:"3311 Foster Ave, Saint Paul, MN", priority_score:44, evidence_score:31, confidence_score:40, validation_score:null, roof_visual_score:null, assessed_value:268000, storm_evidence:{}, created_at:"2026-02-11T00:00:00Z", updated_at:"2026-03-01T00:00:00Z" },
];

export async function getLeads(limit = 200) {
  const client = supabaseAdmin || supabase;
  if (isSupabaseConfigured && client) {
    try {
      for (const table of ["batch_leads", "leads"]) {
        const { data, error } = await client.from(table).select("*").order("created_at", { ascending:false }).limit(limit);
        if (!error && Array.isArray(data) && data.length) return { rows:data, dataMode:"live", table };
      }
      return { rows:[], dataMode:"live", table:null };
    } catch (e) {
      return { rows:DEMO_LEADS.slice(0, limit), dataMode:"demo", error:String((e && e.message) || e) };
    }
  }
  return { rows:DEMO_LEADS.slice(0, limit), dataMode:"demo" };
}

export function demoLeads(limit = 200) { return DEMO_LEADS.slice(0, limit); }

export async function getLeadById(id) {
  const client = supabaseAdmin || supabase;
  if (isSupabaseConfigured && client && id) {
    try {
      for (const table of ["batch_leads", "leads"]) {
        const { data, error } = await client.from(table).select("*").eq("id", id).limit(1);
        if (!error && Array.isArray(data) && data.length) return { row:data[0], dataMode:"live", table };
      }
      return { row:null, dataMode:"live", table:null };
    } catch (e) {
      const row = DEMO_LEADS.find((d) => d.id === id) || null;
      return { row, dataMode:"demo", error:String((e && e.message) || e) };
    }
  }
  return { row:DEMO_LEADS.find((d) => d.id === id) || null, dataMode:"demo" };
}

export function supabaseStatus() {
  return { configured:Boolean(isSupabaseConfigured), adminClient:Boolean(supabaseAdmin), browserClient:Boolean(supabase) };
}
