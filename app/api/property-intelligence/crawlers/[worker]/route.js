// Item #7: autonomous ingestion workers. Hit as
//   POST /api/crawlers/permits        (real, reuses your existing Shovels key)
//   POST /api/crawlers/county_records (stub — needs a chosen vendor)
//   POST /api/crawlers/tax_records    (stub — needs a chosen vendor)
//   POST /api/crawlers/listings       (stub — needs MLS/RESO or a paid feed)
//   POST /api/crawlers/zoning         (stub — needs county GIS/zoning API)
//
// GET /api/crawlers/<worker> returns that worker's run history from
// crawler_runs, so you can see at a glance which ones are actually doing
// anything vs. sitting at not_configured.
//
// Wire a cron (Vercel Cron, or a scheduled GitHub Action hitting these
// URLs) to POST each of these hourly, per the plan. Deliberately NOT
// faking a live county/tax/listings/zoning connector here — every one of
// those needs a vendor decision (which county GIS export, which listings
// feed, ATTOM vs. county assessor scrape, etc.) that's a business call,
// not something to silently pick for you. The permits worker is real
// because you already have a vendor (Shovels) wired for it.

import { supabaseGet, supabasePost } from "../../../../../lib/supabaseRest";
import { findOrCreateProperty } from "../../../../../lib/properties";
import { addTimelineEvent } from "../../../../../lib/timeline";
import { recordChange } from "../../../../../lib/changeDetector";

const KNOWN_WORKERS = ["permits", "county_records", "tax_records", "listings", "zoning"];

async function startRun(workerName) {
  const res = await supabasePost("crawler_runs", [{ worker_name: workerName, status: "running" }]);
  return res.ok ? res.data?.[0]?.run_id : null;
}

async function finishRun(runId, { status, recordsFound = 0, recordsNew = 0, detail }) {
  if (!runId) return;
  await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")}/rest/v1/crawler_runs?run_id=eq.${runId}`, {
    method: "PATCH",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status, records_found: recordsFound, records_new: recordsNew, detail, finished_at: new Date().toISOString() }),
  }).catch(() => {});
}

// --- permits worker: real, reuses PERMIT_API_KEY (Shovels) already used by
// /api/permit-lookup. Walks every tracked property, pulls anything new
// since its last permit event, and writes timeline + change rows.
async function runPermitsWorker(runId) {
  const key = process.env.PERMIT_API_KEY;
  if (!key) {
    await finishRun(runId, { status: "not_configured", detail: "PERMIT_API_KEY not set." });
    return { status: "not_configured", message: "Set PERMIT_API_KEY to enable this worker." };
  }

  const propsRes = await supabaseGet("properties?select=property_id,address&limit=500");
  if (!propsRes.ok) {
    await finishRun(runId, { status: "error", detail: propsRes.error });
    return { status: "error", message: propsRes.error };
  }

  let found = 0, created = 0;
  for (const prop of propsRes.data) {
    try {
      const headers = { "X-API-Key": key, accept: "application/json" };
      const searchRes = await fetch(`https://api.shovels.ai/v2/addresses/search?q=${encodeURIComponent(prop.address)}`, { headers });
      if (!searchRes.ok) continue;
      const searchData = await searchRes.json();
      const match = Array.isArray(searchData) ? searchData[0] : searchData?.items?.[0];
      const geoId = match?.geo_id || match?.id || match?.address_id;
      if (!geoId) continue;

      const permitsRes = await fetch(`https://api.shovels.ai/v2/permits/search?geo_id=${encodeURIComponent(geoId)}`, { headers });
      if (!permitsRes.ok) continue;
      const permitsData = await permitsRes.json();
      const items = Array.isArray(permitsData) ? permitsData : permitsData?.items || [];
      found += items.length;

      // Skip permits already in the timeline for this property (dedupe by source_ref = permit number).
      const existingRes = await supabaseGet(`property_timeline?property_id=eq.${prop.property_id}&event_type=eq.permit&select=source_ref`);
      const existingRefs = new Set(existingRes.ok ? existingRes.data.map((r) => r.source_ref) : []);

      for (const p of items) {
        const permitNumber = p.permit_number || p.id || null;
        if (permitNumber && existingRefs.has(permitNumber)) continue;
        const eventDate = p.file_date || p.issue_date;
        if (!eventDate) continue;
        await addTimelineEvent({
          propertyId: prop.property_id, eventType: "permit", eventDate,
          title: p.permit_type || p.description || "Permit",
          detail: p.status || null, source: "crawler:permits", sourceRef: permitNumber,
        });
        await recordChange({
          propertyId: prop.property_id, changeType: "new_permit",
          detail: p.permit_type || p.description, source: "crawler:permits",
        });
        created += 1;
      }
    } catch { /* one property failing shouldn't kill the whole run */ }
  }

  await finishRun(runId, { status: "success", recordsFound: found, recordsNew: created });
  return { status: "success", recordsFound: found, recordsNew: created };
}

// --- stub workers: honest not_configured until a vendor is chosen and its
// fetch logic dropped into the matching branch below.
async function runStubWorker(workerName, runId, envHint) {
  await finishRun(runId, { status: "not_configured", detail: `No vendor wired for ${workerName}. ${envHint}` });
  return { status: "not_configured", message: `No vendor wired for ${workerName} yet. ${envHint}` };
}

const STUB_HINTS = {
  county_records: "Needs a county-records vendor (e.g. a county assessor open-data API or a paid aggregator like ATTOM). Drop the fetch call in runCountyRecordsWorker().",
  tax_records: "Needs a tax-assessor data source — usually the same county GIS/assessor export as county_records. Drop the fetch call in runTaxRecordsWorker().",
  listings: "Needs an MLS/RESO feed or a paid listings API (e.g. via a broker's IDX access). Drop the fetch call in runListingsWorker().",
  zoning: "Needs your county's zoning/GIS API or shapefile export. Drop the fetch call in runZoningWorker().",
};

async function runWorker(workerName, runId) {
  if (workerName === "permits") return runPermitsWorker(runId);
  return runStubWorker(workerName, runId, STUB_HINTS[workerName] || "");
}

export async function POST(req, { params }) {
  const { worker } = params;
  if (!KNOWN_WORKERS.includes(worker)) {
    return Response.json({ ok: false, error: `Unknown worker "${worker}". Valid: ${KNOWN_WORKERS.join(", ")}` }, { status: 400 });
  }
  const runId = await startRun(worker);
  const result = await runWorker(worker, runId);
  return Response.json({ ok: true, worker, run_id: runId, ...result });
}

export async function GET(req, { params }) {
  const { worker } = params;
  if (!KNOWN_WORKERS.includes(worker)) {
    return Response.json({ ok: false, error: `Unknown worker "${worker}". Valid: ${KNOWN_WORKERS.join(", ")}` }, { status: 400 });
  }
  const res = await supabaseGet(`crawler_runs?worker_name=eq.${worker}&select=*&order=started_at.desc&limit=20`);
  return Response.json({ ok: res.ok, runs: res.ok ? res.data : [], error: res.ok ? null : res.error });
}
