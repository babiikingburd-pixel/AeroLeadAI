import { supabaseServer } from "../../../../lib/supabaseServer";
import { VALIDATION_CAPABILITIES, gapSummary } from "../../../../lib/twincities/validationCapabilities";

// VALIDATE-ALL: when a lead enters the priority queue (the "500 box"), this
// attempts EVERY evidence dimension the system currently knows how to
// check — not just permit. Where a dimension has no working validator, it
// says so explicitly (via the capability registry) instead of silently
// doing nothing and leaving the lead looking merely "unchecked" with no
// indication why.
//
// POST /api/enrich/validate-all { limit?: number }
//
// This does NOT replace priority-worker (permit -> gate -> rescore stays
// exactly as it was). It's a broader pass: permit (real) + value (real
// attempt against a confirmed-broken source, so the failure is honest and
// visible) + storm (status check only — see capability registry for why
// this can't be a real per-lead call) + image (fetch, clearly labeled as
// fetch-only since no review step exists yet).
export const maxDuration = 60;

async function attemptPermit(origin, lead) {
  try {
    const addr = `${lead.address}, ${lead.city}, MN`;
    const res = await fetch(`${origin}/api/permit-lookup?address=${encodeURIComponent(addr)}`);
    if (!res.ok) return { attempted: true, ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { attempted: true, ok: true, recordCount: (data.records || []).length, lowPriority: data.lowPriority };
  } catch (e) {
    return { attempted: true, ok: false, error: e.message };
  }
}

async function attemptValue(origin, lead) {
  // Real attempt against the CONFIRMED-BROKEN county GIS endpoints. This is
  // deliberate: we want the actual current failure, not a skipped step —
  // that's what makes the capability gap honest instead of assumed.
  try {
    const res = await fetch(`${origin}/api/sync-assessor-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: [lead.id] }),
    });
    if (!res.ok) return { attempted: true, ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { attempted: true, ok: true, enriched: data.enriched ?? 0, unreachable: data.unreachable ?? 0, note: data.note };
  } catch (e) {
    return { attempted: true, ok: false, error: e.message };
  }
}

async function attemptImageFetch(origin, lead) {
  try {
    const res = await fetch(`${origin}/api/imagery-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: lead.lat, lon: lead.lon, address: lead.address, leadId: lead.id }),
    });
    return { attempted: true, ok: res.ok, note: "fetch only — no review step exists yet, see capability registry" };
  } catch (e) {
    return { attempted: true, ok: false, error: e.message };
  }
}

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(body.limit ?? 10, 50); // deliberately small default — this hits 3 external calls per lead
  const origin = new URL(req.url).origin;

  const { data: leads, error } = await supabase
    .from("batch_leads")
    .select("id, address, city, county, lat, lon, permit_evidence_status, value_evidence_status, storm_evidence_status, image_evidence_status")
    .eq("enrichment_queue", "priority")
    .eq("enrichment_status", "pending")
    .order("gap_priority", { ascending: false, nullsFirst: false })
    .order("priority_score", { ascending: false })
    .limit(limit);

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!leads?.length) {
    return Response.json({ ok: true, processed: 0, note: "Priority queue empty.", capabilityGaps: gapSummary() });
  }

  const results = [];
  for (const lead of leads) {
    const permit = await attemptPermit(origin, lead);
    const value = await attemptValue(origin, lead);
    // storm: status-only check, no per-lead fetch attempted (bulk_only capability)
    const storm = {
      attempted: false,
      status: lead.storm_evidence_status || "unknown",
      reason: VALIDATION_CAPABILITIES.storm.notes,
    };
    const image = await attemptImageFetch(origin, lead);

    results.push({
      id: lead.id, address: lead.address, city: lead.city,
      permit, value, storm, image,
    });
  }

  const valueEnrichedCount = results.filter((r) => r.value.ok && r.value.enriched > 0).length;

  return Response.json({
    ok: true,
    processed: results.length,
    summary: {
      permit_attempted: results.filter((r) => r.permit.attempted).length,
      permit_succeeded: results.filter((r) => r.permit.ok).length,
      value_attempted: results.filter((r) => r.value.attempted).length,
      value_actually_enriched: valueEnrichedCount,
      value_confirmed_broken: valueEnrichedCount === 0 && results.length > 0,
      image_fetched: results.filter((r) => r.image.ok).length,
      storm_needs_backfill: results.filter((r) => r.storm.status === "unknown").length,
    },
    capabilityGaps: gapSummary(),
    note: valueEnrichedCount === 0 && results.length > 0
      ? "Value validation attempted for every lead and enriched 0 — this confirms the county GIS endpoints are still broken (see capabilityGaps). This is not a bug in this endpoint; it's the honest signal that real endpoints need to be found."
      : undefined,
    results,
  });
}
