import { supabaseServer } from "../../../../lib/supabaseServer";
import { applyEvidenceAndRescore } from "../../../../lib/twincities/evidenceEvents";
import { getActiveAlerts, parseStormSignals } from "../../../../lib/evidenceIndex/enrichers/stormOverlay";

// FREE EVIDENCE CHECK — on-demand, per-property, zero-cost.
//
// Distinct from the other storm capability in this codebase (see
// validationCapabilities.js's "storm" entry): NOAA's historical Storm
// Events Database ships as annual multi-MB CSV.gz files, which is genuinely
// bulk-only — that's what storm-backfill sweeps. NWS active alerts
// (api.weather.gov) is a SEPARATE, free, keyless source that answers a
// single lat/lon on demand, so unlike historical hail swaths it can be
// checked per-property right now. It only reports CURRENT/recent weather,
// not deep history, so it complements storm-backfill rather than replacing
// it.
//
// POST /api/twincities/free-evidence { propertyId, latitude, longitude }
export const maxDuration = 30;

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  let body = {};
  try { body = await req.json(); } catch {}
  const propertyId = body.propertyId;
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  if (!propertyId) return Response.json({ ok: false, error: "propertyId required" }, { status: 400 });
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return Response.json({ ok: false, error: "latitude and longitude must be numbers" }, { status: 400 });
  }

  const { data: lead, error: selErr } = await supabase
    .from("batch_leads")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();
  if (selErr) return Response.json({ ok: false, error: selErr.message }, { status: 500 });
  if (!lead) return Response.json({ ok: false, error: `No lead found for propertyId ${propertyId}` }, { status: 404 });

  const alerts = await getActiveAlerts(latitude, longitude);
  const signals = parseStormSignals(alerts);

  // Additive only — an absent active alert today must never erase stronger
  // historical evidence a bulk NOAA pass already confirmed.
  const evidencePatch = {};
  if (signals.hailInches > 0 && signals.hailInches > (lead.hail_inches ?? 0)) {
    evidencePatch.hail_inches = signals.hailInches;
  }
  if (signals.windMph > 0 && signals.windMph > (lead.wind_mph ?? 0)) {
    evidencePatch.wind_mph = signals.windMph;
  }
  if (evidencePatch.hail_inches != null || evidencePatch.wind_mph != null) {
    evidencePatch.storm_date = new Date().toISOString().slice(0, 10);
  }
  if (lead.storm_evidence_status !== "verified") {
    evidencePatch.storm_evidence_status = alerts.length > 0 ? "verified" : "none_found";
  }
  if (lead.lat == null) evidencePatch.lat = latitude;
  if (lead.lon == null) evidencePatch.lon = longitude;

  let rescoreResult;
  try {
    rescoreResult = await applyEvidenceAndRescore(supabase, lead, evidencePatch, "free_evidence_nws", {
      source: "NWS active alerts (api.weather.gov)",
      activeAlerts: alerts.length,
      hailInches: signals.hailInches,
      windMph: signals.windMph,
      heavySnow: signals.heavySnow,
      heavyRain: signals.heavyRain,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    propertyId,
    source: "NWS active alerts — free, keyless, real-time only (not historical)",
    activeAlerts: alerts.length,
    signals,
    scoreBefore: rescoreResult.before,
    scoreAfter: rescoreResult.after,
    delta: rescoreResult.delta,
    tier: rescoreResult.scored.tier,
    evidenceApplied: evidencePatch,
    historyFailed: rescoreResult.historyFailed,
    evidenceEventFailed: rescoreResult.evidenceEventFailed,
  });
}
