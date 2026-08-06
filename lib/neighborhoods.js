// Item #6: neighborhood intelligence. Honest split: permit_velocity and
// investor_concentration are computed here from data you actually have
// (properties + timeline). growth_score, population_trend, and
// commercial_expansion_score are external signals (census, migration data,
// commercial permit feeds) — there's no live source wired for those yet, so
// they stay as manual/crawler-fed inputs (upsertExternalStats) rather than
// being faked from internal data that can't support them.

import { supabaseGet, supabasePost, supabasePatch } from "./supabaseRest";

export async function findOrCreateNeighborhood({ name, county, city }) {
  if (!name) return { ok: false, error: "name required" };
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const existing = await supabaseGet(`neighborhoods?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`);
  if (existing.ok && existing.data?.length) return { ok: true, neighborhood: existing.data[0] };
  const created = await supabasePost("neighborhoods", [{ name, county: county ?? null, city: city ?? null }]);
  if (!created.ok) return created;
  return { ok: true, neighborhood: created.data?.[0] };
}

// Computes what's derivable from internal data right now.
export async function computeInternalStats(neighborhoodId) {
  const propsRes = await supabaseGet(`properties?neighborhood_id=eq.${neighborhoodId}&select=property_id,owner_entity_type,owner_name`);
  if (!propsRes.ok) return propsRes;
  const properties = propsRes.data;
  const propertyCount = properties.length;
  if (!propertyCount) return { ok: true, stats: { permit_velocity: 0, investor_concentration: 0, avg_renovation_spend: null } };

  const investorCount = properties.filter((p) => p.owner_entity_type === "llc" || /\bllc\b/i.test(p.owner_name || "")).length;
  const investor_concentration = investorCount / propertyCount;

  const propertyIds = properties.map((p) => p.property_id);
  const quarterAgo = new Date();
  quarterAgo.setMonth(quarterAgo.getMonth() - 3);
  const idFilter = propertyIds.map((id) => `"${id}"`).join(",");
  const permitsRes = propertyIds.length
    ? await supabaseGet(`property_timeline?property_id=in.(${idFilter})&event_type=eq.permit&event_date=gte.${quarterAgo.toISOString().slice(0, 10)}&select=property_id`)
    : { ok: true, data: [] };
  const permitCountQ = permitsRes.ok ? permitsRes.data.length : 0;
  const permit_velocity = (permitCountQ / propertyCount) * 100; // permits per 100 properties per quarter

  const stats = { permit_velocity, investor_concentration, computed_at: new Date().toISOString() };
  await upsertStats(neighborhoodId, stats);
  return { ok: true, stats, property_count: propertyCount };
}

// External signals — call this from wherever you feed in census/migration/
// commercial-permit data once you've picked a source. Never invented here.
export async function upsertExternalStats(neighborhoodId, { growth_score, population_trend, commercial_expansion_score, avg_renovation_spend }) {
  const patch = {};
  if (growth_score != null) patch.growth_score = growth_score;
  if (population_trend != null) patch.population_trend = population_trend;
  if (commercial_expansion_score != null) patch.commercial_expansion_score = commercial_expansion_score;
  if (avg_renovation_spend != null) patch.avg_renovation_spend = avg_renovation_spend;
  if (!Object.keys(patch).length) return { ok: false, error: "no fields provided" };
  return upsertStats(neighborhoodId, patch);
}

async function upsertStats(neighborhoodId, fields) {
  const existing = await supabaseGet(`neighborhood_stats?neighborhood_id=eq.${neighborhoodId}&select=neighborhood_id&limit=1`);
  if (existing.ok && existing.data?.length) {
    return supabasePatch(`neighborhood_stats?neighborhood_id=eq.${neighborhoodId}`, { ...fields, computed_at: new Date().toISOString() });
  }
  return supabasePost("neighborhood_stats", [{ neighborhood_id: neighborhoodId, ...fields }]);
}

export async function getNeighborhoodStats(neighborhoodId) {
  return supabaseGet(`neighborhood_stats?neighborhood_id=eq.${neighborhoodId}&select=*&limit=1`);
}
