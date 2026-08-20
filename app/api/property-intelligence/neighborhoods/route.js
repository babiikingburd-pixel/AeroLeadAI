import { findOrCreateNeighborhood, computeInternalStats, upsertExternalStats, getNeighborhoodStats } from "../../../../lib/neighborhoods";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const neighborhoodId = searchParams.get("neighborhoodId");
  if (!neighborhoodId) return Response.json({ ok: false, error: "neighborhoodId required" }, { status: 400 });
  const res = await getNeighborhoodStats(neighborhoodId);
  return Response.json({ ok: res.ok, stats: res.ok ? res.data?.[0] || null : null, error: res.ok ? null : res.error });
}

// action: 'create' | 'recompute_internal' | 'set_external'
export async function POST(req) {
  const body = await req.json();
  const { action, name, county, city, neighborhoodId, growth_score, population_trend, commercial_expansion_score, avg_renovation_spend } = body || {};

  if (action === "create") {
    const res = await findOrCreateNeighborhood({ name, county, city });
    return Response.json(res);
  }
  if (action === "recompute_internal") {
    if (!neighborhoodId) return Response.json({ ok: false, error: "neighborhoodId required" }, { status: 400 });
    const res = await computeInternalStats(neighborhoodId);
    return Response.json(res);
  }
  if (action === "set_external") {
    if (!neighborhoodId) return Response.json({ ok: false, error: "neighborhoodId required" }, { status: 400 });
    const res = await upsertExternalStats(neighborhoodId, { growth_score, population_trend, commercial_expansion_score, avg_renovation_spend });
    return Response.json(res);
  }
  return Response.json({ ok: false, error: "action must be 'create', 'recompute_internal', or 'set_external'" }, { status: 400 });
}
