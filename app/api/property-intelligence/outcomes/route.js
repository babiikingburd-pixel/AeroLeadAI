import { logOutcome, getOutcomes, getFunnelSummary } from "../../../../lib/outcomes";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId");
  if (propertyId) {
    const res = await getOutcomes(propertyId);
    return Response.json({ ok: res.ok, outcomes: res.ok ? res.data : [], error: res.ok ? null : res.error });
  }
  const summary = await getFunnelSummary();
  return Response.json(summary);
}

export async function POST(req) {
  const body = await req.json();
  const { propertyId, stage, stageValue, notes } = body || {};
  if (!stage) return Response.json({ ok: false, error: "stage required" }, { status: 400 });
  const res = await logOutcome({ propertyId, stage, stageValue, notes });
  return Response.json(res);
}
