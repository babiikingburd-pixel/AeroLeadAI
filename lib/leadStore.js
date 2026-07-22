"use client";
// Shared client-side lead store — the single source the Dashboard, CRM panel,
// and Background Scanner all read/write. Backed by localStorage (same
// fallback pattern as the rest of the app); mirrors the property objects the
// console produces so no migration is needed.
const KEY = "aeroleadai_leads_v1";

export const LEAD_STATUSES = ["new", "contacted", "quoted", "won", "lost"];

export function loadLeads() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}

export function saveLeads(leads) {
  try { localStorage.setItem(KEY, JSON.stringify(leads)); } catch {}
  return leads;
}

export function upsertLead(lead) {
  const leads = loadLeads();
  const i = leads.findIndex((l) => l.address?.toLowerCase() === lead.address?.toLowerCase());
  const merged = i >= 0 ? { ...leads[i], ...lead, updatedAt: new Date().toISOString() } : { status: "new", createdAt: new Date().toISOString(), ...lead };
  if (i >= 0) leads[i] = merged; else leads.push(merged);
  return saveLeads(leads);
}

export function setLeadStatus(address, status) {
  return upsertLead({ address, status });
}

export function setFollowUp(address, dateIso) {
  return upsertLead({ address, followUp: dateIso });
}

// ---- Advanced CRM Automation: notes, tasks, communication logging ----
function findLead(leads, address) {
  return leads.findIndex((l) => l.address?.toLowerCase() === address?.toLowerCase());
}

export function addNote(address, text) {
  const leads = loadLeads();
  const i = findLead(leads, address);
  if (i < 0) return leads;
  const notes = leads[i].notes_log || [];
  notes.unshift({ id: Math.random().toString(36).slice(2), text, at: new Date().toISOString() });
  leads[i] = { ...leads[i], notes_log: notes };
  return saveLeads(leads);
}

export function addTask(address, title, dueDate) {
  const leads = loadLeads();
  const i = findLead(leads, address);
  if (i < 0) return leads;
  const tasks = leads[i].tasks || [];
  tasks.push({ id: Math.random().toString(36).slice(2), title, dueDate: dueDate || null, done: false, createdAt: new Date().toISOString() });
  leads[i] = { ...leads[i], tasks };
  return saveLeads(leads);
}

export function toggleTask(address, taskId) {
  const leads = loadLeads();
  const i = findLead(leads, address);
  if (i < 0) return leads;
  const tasks = (leads[i].tasks || []).map((t) => t.id === taskId ? { ...t, done: !t.done } : t);
  leads[i] = { ...leads[i], tasks };
  return saveLeads(leads);
}

// Manual log of an email/SMS sent to the lead. If a webhook is configured
// server-side (see /api/comm-log) this also fires the actual send; without
// one it's an honest manual log entry, same pattern as CRM sync.
export function logCommunication(address, channel, summary) {
  const leads = loadLeads();
  const i = findLead(leads, address);
  if (i < 0) return leads;
  const log = leads[i].comm_log || [];
  log.unshift({ id: Math.random().toString(36).slice(2), channel, summary, at: new Date().toISOString() });
  leads[i] = { ...leads[i], comm_log: log };
  return saveLeads(leads);
}

// Pulls the console's own persisted properties AND the Batch pipeline's
// separate localStorage store into the shared lead store, so the Map,
// Dashboard, and CRM all reflect everything scanned anywhere in the app.
export function importConsoleProperties() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (!/propert/i.test(k)) continue;
      const raw = localStorage.getItem(k);
      if (!raw || raw[0] !== "{") continue;
      const obj = JSON.parse(raw);
      const props = obj.properties || obj;
      Object.values(props || {}).forEach((p) => {
        if (p && p.address) {
          // aiFindings[0].results is an ARRAY of {domain, concern_score, notes}
          // (one entry per scored domain), not an object keyed by domain name.
          const results = p.folders?.aiFindings?.[0]?.results || [];
          const roofResult = Array.isArray(results) ? results.find((r) => r.domain === "roof") : null;
          upsertLead({
            address: p.address, lat: p.lat, lon: p.lon,
            findingsScore: p.findingsScore ?? null,
            lowPriority: p.lowPriority || false,
            confidence: roofResult?.confidence || null,
            indicators: roofResult?.indicators || [],
            notes: roofResult?.notes || "",
          });
        }
      });
    }
    // Batch pipeline store: "aerolead:batch:v1" -> { items: {id: {...}}, order: [...] }.
    // Items carry per-domain images/scores ({ roof, tree, driveway }, each
    // possibly null) rather than a single flat dataUrl/damageScore — pull the
    // roof domain specifically (this store's "findingsScore" is roof-focused
    // to match the console) plus whichever domain images exist for imagery.
    const rawBatch = localStorage.getItem("aerolead:batch:v1");
    if (rawBatch) {
      const saved = JSON.parse(rawBatch);
      (saved.order || []).map((id) => saved.items?.[id]).filter(Boolean).forEach((it) => {
        if (it.address && it.lat && it.lon) {
          const scores = it.scores || {};
          const images = it.images || {};
          const domainScores = ["roof", "tree", "driveway"].map((d) => scores[d]?.score).filter((s) => s !== null && s !== undefined);
          const combinedScore = domainScores.length ? Math.max(...domainScores) : null;
          const imagery = ["roof", "tree", "driveway"].map((d) => images[d]?.dataUrl).filter(Boolean);
          upsertLead({
            address: it.address, lat: it.lat, lon: it.lon,
            findingsScore: scores.roof?.score ?? combinedScore,
            lowPriority: !!it.permitWithin10y,
            notes: scores.roof?.notes || it.permitNotes || "",
            imagery,
            source: "batch-pipeline",
          });
        }
      });
    }
  } catch {}
  return loadLeads();
}
