import { recordChange, getTopOpportunities } from "../../../../lib/changeDetector";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || 25);
  const res = await getTopOpportunities(limit);
  return Response.json({ ok: res.ok, opportunities: res.ok ? res.data : [], error: res.ok ? null : res.error });
}

export async function POST(req) {
  const body = await req.json();
  const { propertyId, changeType, magnitude, detail, source } = body || {};
  if (!propertyId || !changeType) return Response.json({ ok: false, error: "propertyId and changeType required" }, { status: 400 });
  const res = await recordChange({ propertyId, changeType, magnitude, detail, source });
  return Response.json(res);
}
