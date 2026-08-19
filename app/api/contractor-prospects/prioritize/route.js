// Prioritize a contractor prospect, then immediately rebuild its live lead list.
import { supabaseServer } from "../../../../lib/supabaseServer";
import { calculatePriority } from "../../../../lib/twincities/priorityEngine";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function scoreRow(row) {
  const result = calculatePriority({
    county: row.county,
    yearBuilt: row.year_built,
    permit_within_10y: row.permit_within_10y,
    permitChecked: !!(row.permit_notes && row.permit_notes.length > 0),
    hailInches: row.hail_inches,
    windMph: row.wind_mph,
    assessedValue: row.assessed_value,
    reviewStatus: row.review_status,
    roofEstimateUsd: row.replacement_cost ?? null,
    heavySnowRegion: row.damage_notes?.heavySnowRegion === true,
    heavyRainRegion: row.damage_notes?.heavyRainRegion === true,
    treeOverhang: row.damage_notes?.treeOverhang === true || (row.tree_score ?? 0) >= 50,
    largeOverhang: row.damage_notes?.largeOverhang === true || (row.tree_score ?? 0) >= 80,
    drivewayCrackRisk: (row.driveway_score ?? 0) >= 50,
    gutterIndicator: row.damage_notes?.gutterIndicator === true,
  });
  return { ...row, _score: result.priorityScore, evidenceScore: result.evidenceScore, confidenceScore: result.confidenceScore, entered: result.entered };
}

function normalizedAddress(row) {
  return String(row.address || row.property_address || "")
    .toLowerCase()
    .replace(/\b(apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function propertyKey(row) {
  return String(row.parcel_id || row.pid || row.property_id || row.apn || normalizedAddress(row) || `${row.lat || ""},${row.lon || ""}`);
}

function isLikelySingleFamily(row) {
  const type = String(row.property_type || row.building_type || row.land_use || row.use_code || row.occupancy || row.property_class || "").toLowerCase();
  const addr = String(row.address || row.property_address || "").toLowerCase();
  const badType = /(apartment|multi[- ]?family|multifamily|condo|condominium|townhome|townhouse|commercial|retail|office|industrial|mixed use|assisted living|senior living|hotel|motel)/;
  const unitAddress = /\b(apt|apartment|unit|suite|ste)\b|#\s*[a-z0-9-]+/;
  if (badType.test(type) || unitAddress.test(addr)) return false;
  if (Number(row.units || row.unit_count || row.dwelling_units || 1) > 1) return false;
  return true;
}

function dedupeResidential(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!isLikelySingleFamily(row)) return false;
    const key = propertyKey(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const { businessName } = await req.json().catch(() => ({}));
  if (!businessName?.trim()) return Response.json({ ok: false, error: "businessName required." }, { status: 400 });

  const { data: top, error: topErr } = await supabase
    .from("contractor_candidates")
    .select("prospect_score")
    .eq("prospect", true)
    .order("prospect_score", { ascending: false })
    .limit(1);
  if (topErr) return Response.json({ ok: false, error: topErr.message }, { status: 500 });

  const currentTop = top?.[0]?.prospect_score ?? 0;
  const newScore = Math.min(100, Math.max(currentTop + 1, 97));

  const { data: updated, error: updateErr } = await supabase
    .from("contractor_candidates")
    .update({ prospect_score: newScore, pitch_status: "prioritized" })
    .eq("business_name", businessName.trim())
    .select()
    .single();
  if (updateErr) return Response.json({ ok: false, error: updateErr.message }, { status: 500 });
  if (!updated) return Response.json({ ok: false, error: "Contractor prospect not found." }, { status: 404 });

  const isApex = /\bapex\b/i.test(updated.business_name || "");
  const cities = isApex ? ["Apple Valley","Eagan","Burnsville","Lakeville","Rosemount"] : (updated.service_area_cities || []);
  let leadQuery = supabase.from("batch_leads").select("*").eq("sales_status", "new").limit(1000);
  if (cities.length) leadQuery = leadQuery.in("city", cities);
  const { data: rows, error: leadsErr } = await leadQuery;
  if (leadsErr) return Response.json({ ok: true, contractor: updated, leads: [], note: "Prioritized, but lead recalibration failed: " + leadsErr.message });

  const leads = dedupeResidential((rows || [])
    .map(scoreRow)
    .filter((r) => r.entered && r._score > 0)
    .sort((a, b) => b._score - a._score))
    .slice(0, isApex ? 50 : 10);

  return Response.json({ ok: true, contractor: updated, leads, newTopScore: newScore });
}
