import { computePredictions, getPredictions } from "../../../../lib/predictions";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  if (!propertyId) return Response.json({ ok: false, error: "propertyId required" }, { status: 400 });
  const res = await getPredictions(propertyId);
  return Response.json(res);
}

// Recompute predictions for a property from its current timeline/changes/graph.
// Call this after any crawler run or manual data entry that touches the property.
export async function POST(req) {
  const body = await req.json();
  const { propertyId } = body || {};
  if (!propertyId) return Response.json({ ok: false, error: "propertyId required" }, { status: 400 });
  const res = await computePredictions(propertyId);
  return Response.json(res);
}
