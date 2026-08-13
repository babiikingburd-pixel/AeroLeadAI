import { supabaseServer } from "../../../../lib/supabaseServer";
import { applyEvidenceAndRescore } from "../../../../lib/twincities/evidenceEvents";
export const dynamic = "force-dynamic";

// NOAA Storm Events backfill.
//
// IMPORTANT FRAMING (per the product's own evidence standard): NOAA data
// establishes that a property was inside a storm-affected area. That is
// STORM EXPOSURE EVIDENCE, not proof that this specific roof is damaged.
// Nothing here writes a "damaged" conclusion — it writes hail size, wind
// speed, and event date, which the existing priorityEngine treats as
// evidence inputs. Image + human review is what turns exposure into a
// qualified inspection opportunity.
//
// Source: NOAA NCEI Storm Events Database CSV exports (public domain).
// https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
// The "details" file per year contains BEGIN_LAT/BEGIN_LON, EVENT_TYPE,
// MAGNITUDE (hail inches / wind knots), and BEGIN_DATE_TIME.
//
// POST /api/enrich/storm-backfill
// body: { year?: number, radiusMiles?: number, dryRun?: boolean, limit?: number }
// NOTE ON maxDuration BELOW: 300s requires Vercel Pro. This project is
// confirmed on the free/Hobby tier (Advanced Deployment Protection returned
// "not enabled on your team" when tested), which caps serverless functions
// far lower in practice. A single call trying to page through all 152,203
// leads will likely time out mid-run before hitting this ceiling. Call this
// route repeatedly with `offset` advancing by `limit` each time (e.g. limit
// 5000, offset 0, then 5000, then 10000...) rather than one giant call.
export const maxDuration = 300;

const MN_BBOX = { minLat: 43.4, maxLat: 49.4, minLon: -97.3, maxLon: -89.5 };

// Haversine distance in miles.
function distanceMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

async function fetchStormEvents(year) {
  // The NCEI directory listing is needed because filenames embed a
  // creation date that changes (e.g. d20240116). Fetch the index, find
  // the matching details file for the year, then pull it.
  const base = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";
  const indexRes = await fetch(base);
  if (!indexRes.ok) throw new Error(`NCEI index fetch failed: ${indexRes.status}`);
  const indexHtml = await indexRes.text();

  const pattern = new RegExp(`StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`);
  const match = indexHtml.match(pattern);
  if (!match) throw new Error(`No NOAA storm details file found for year ${year}`);

  const fileRes = await fetch(base + match[0]);
  if (!fileRes.ok) throw new Error(`NOAA file fetch failed: ${fileRes.status}`);

  // Decompress the gzip stream natively.
  const ds = new DecompressionStream("gzip");
  const text = await new Response(fileRes.body.pipeThrough(ds)).text();
  return text;
}

function extractRelevantEvents(csvText) {
  const lines = csvText.split("\n");
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]);
  const idx = (name) => header.indexOf(name);

  const iType = idx("EVENT_TYPE");
  const iMag = idx("MAGNITUDE");
  const iLat = idx("BEGIN_LAT");
  const iLon = idx("BEGIN_LON");
  const iDate = idx("BEGIN_DATE_TIME");
  const iState = idx("STATE");

  const events = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCsvLine(lines[i]);
    const type = (c[iType] || "").toLowerCase();
    if (!type.includes("hail") && !type.includes("thunderstorm wind") && !type.includes("high wind")) continue;

    const lat = parseFloat(c[iLat]);
    const lon = parseFloat(c[iLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat < MN_BBOX.minLat || lat > MN_BBOX.maxLat || lon < MN_BBOX.minLon || lon > MN_BBOX.maxLon) continue;

    const mag = parseFloat(c[iMag]);
    events.push({
      type: type.includes("hail") ? "hail" : "wind",
      // NOAA hail MAGNITUDE is inches; wind MAGNITUDE is knots -> mph.
      hailInches: type.includes("hail") && isFinite(mag) ? mag : null,
      windMph: !type.includes("hail") && isFinite(mag) ? Math.round(mag * 1.15078) : null,
      lat, lon,
      date: c[iDate] || null,
      state: c[iState] || null,
    });
  }
  return events;
}

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const year = body.year ?? new Date().getFullYear() - 1;
  const radiusMiles = body.radiusMiles ?? 3;
  const dryRun = body.dryRun === true;
  const limit = Math.min(body.limit ?? 5000, 200000); // safe default chunk; raise only if you've confirmed Pro/longer timeouts
  const startOffset = Math.max(body.offset ?? 0, 0);

  try {
    const csvText = await fetchStormEvents(year);
    const events = extractRelevantEvents(csvText);
    if (!events.length) {
      return Response.json({ ok: true, year, eventsFound: 0, matched: 0, note: "No qualifying MN storm events for this year." });
    }

    // Paginate through ALL leads with coordinates, not a single capped
    // query. batch_leads has 152,203 rows; a single .limit() call was
    // silently only ever checking a third of the database against storm
    // events. `limit` here now means "max rows to page through", default
    // large enough to cover the whole table.
    //
    // PRIORITIZE_QUEUE MODE: storm is a bulk-only capability (see
    // validationCapabilities.js — NOAA ships annual CSV.gz files, not a
    // per-point API, so checking one lead on demand isn't practical). The
    // honest way to make top-500 leads get storm-checked promptly anyway
    // is to make the BULK pass check them first, not to fake a per-lead
    // call. When prioritizeQueue is true, queued leads are checked before
    // the general unordered sweep reaches them.
    const LEAD_FIELDS = "id, lat, lon, hail_inches, wind_mph, county, year_built, permit_within_10y, permit_notes, assessed_value, review_status, replacement_cost, damage_notes, driveway_score, priority_score";
    let leads = [];

    if (body.prioritizeQueue) {
      const { data: queued, error: qErr } = await supabase
        .from("batch_leads")
        .select(LEAD_FIELDS)
        .eq("enrichment_queue", "priority")
        .not("lat", "is", null)
        .not("lon", "is", null)
        .order("gap_priority", { ascending: false, nullsFirst: false })
        .order("priority_score", { ascending: false })
        .limit(limit);
      if (qErr) throw new Error(qErr.message);
      leads.push(...(queued || []));
    }

    const PAGE_SIZE = 1000;
    let offset = startOffset;
    const alreadyIncluded = new Set(leads.map((l) => l.id));
    while (leads.length < limit) {
      const { data: page, error } = await supabase
        .from("batch_leads")
        .select(LEAD_FIELDS)
        .not("lat", "is", null)
        .not("lon", "is", null)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      if (!page?.length) break;
      for (const row of page) {
        if (!alreadyIncluded.has(row.id)) {
          leads.push(row);
          alreadyIncluded.add(row.id);
        }
      }
      offset += PAGE_SIZE;
      if (page.length < PAGE_SIZE) break; // last page
    }
    leads = leads.slice(0, limit);

    const updates = [];
    for (const lead of leads) {
      let bestHail = null, bestWind = null, bestDate = null;
      for (const ev of events) {
        if (Math.abs(ev.lat - lead.lat) > 0.1 || Math.abs(ev.lon - lead.lon) > 0.1) continue; // cheap prefilter
        if (distanceMiles(lead.lat, lead.lon, ev.lat, ev.lon) > radiusMiles) continue;
        if (ev.hailInches != null && (bestHail == null || ev.hailInches > bestHail)) { bestHail = ev.hailInches; bestDate = ev.date; }
        if (ev.windMph != null && (bestWind == null || ev.windMph > bestWind)) { bestWind = ev.windMph; bestDate = bestDate || ev.date; }
      }
      if (bestHail != null || bestWind != null) {
        updates.push({ lead, hail_inches: bestHail, wind_mph: bestWind, storm_date: bestDate ? new Date(bestDate).toISOString().slice(0, 10) : null });
      }
    }

    if (dryRun) {
      return Response.json({
        ok: true, dryRun: true, year, eventsFound: events.length,
        leadsScanned: leads.length, wouldUpdate: updates.length,
        sample: updates.slice(0, 5).map((u) => ({ id: u.lead.id, hail_inches: u.hail_inches, wind_mph: u.wind_mph })),
      });
    }

    // RE-SCORE every lead that actually got new storm evidence, via the
    // shared evidence-event handler (was: hand-rolled calculatePriority +
    // update + score_history insert, duplicated near-verbatim in
    // priority-worker — now one function both use). Writing hail_inches/
    // wind_mph without a rescore step was the exact gap flagged: storm data
    // landing in the database but never reaching the ranking engine.
    let written = 0, rescored = 0, historyFailures = 0;
    for (const u of updates) {
      try {
        const result = await applyEvidenceAndRescore(
          supabase,
          u.lead,
          { hail_inches: u.hail_inches, wind_mph: u.wind_mph, storm_date: u.storm_date, storm_evidence_status: "verified" },
          "storm_backfill",
          { hailInches: u.hail_inches, windMph: u.wind_mph, stormDate: u.storm_date, year },
        );
        written++;
        rescored++;
        if (result.historyFailed) historyFailures++;
      } catch (e) {
        // A failed write here means this lead's storm data did NOT save —
        // do not count it toward `written`.
      }
    }

    return Response.json({
      ok: true, year, eventsFound: events.length, leadsScanned: leads.length,
      matched: updates.length, written, rescored, historyFailures, radiusMiles,
      nextOffset: startOffset + leads.length,
      note: leads.length === limit ? `More leads may remain — call again with offset:${startOffset + leads.length}` : "Reached end of table.",
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
