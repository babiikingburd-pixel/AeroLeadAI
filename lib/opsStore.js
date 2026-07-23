"use client";
import supabase from "./supabaseClient";

// Jobs + contractors live in Supabase only (see supabase_ops_schema.sql) —
// unlike leadStore's localStorage fallback, these need to be shared across
// the whole team (ops center, BI engine, customer portal all read the same
// job), so there's no meaningful single-browser fallback. Without Supabase
// configured, every function here degrades to returning empty/no-op rather
// than throwing, and callers show "Supabase required" messaging.

export const JOB_STATUSES = ["new", "scheduled", "in_progress", "completed", "canceled"];

export function opsAvailable() {
  return !!supabase;
}

export async function listJobs() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("jobs").select("*, contractors(name)").order("created_at", { ascending: false }).limit(500);
  return error ? [] : data;
}

export async function upsertJob(job) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("jobs").upsert(job).select().single();
  return error ? null : data;
}

export async function createJobFromLead(lead, damageSummary) {
  if (!supabase) return null;
  const zipMatch = (lead.address || "").match(/\b(\d{5})\b/);
  const { data, error } = await supabase.from("jobs").insert({
    address: lead.address, lat: lead.lat || null, lon: lead.lon || null,
    zip: zipMatch ? zipMatch[1] : null,
    findings_score: lead.findingsScore ?? null,
    revenue_estimate: lead.estValue || null,
    damage_summary: damageSummary || null, // annotated damage list, for a later quality audit's "before" comparison
    status: "new",
  }).select().single();
  return error ? null : data;
}

export async function getJobByToken(token) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("jobs").select("*, contractors(name, phone)").eq("share_token", token).maybeSingle();
  return error ? null : data;
}

export async function listContractors() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("contractors").select("*").order("name");
  return error ? [] : data;
}

export async function upsertContractor(contractor) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("contractors").upsert(contractor).select().single();
  return error ? null : data;
}

export async function deleteContractor(id) {
  if (!supabase) return;
  await supabase.from("contractors").delete().eq("id", id);
}

export async function deleteJob(id) {
  if (!supabase) return;
  await supabase.from("jobs").delete().eq("id", id);
}
