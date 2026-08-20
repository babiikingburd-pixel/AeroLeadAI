import { findOrCreateProperty, listProperties } from "../../../../lib/properties";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const county = searchParams.get("county");
  const limit = Number(searchParams.get("limit") || 50);
  const res = await listProperties({ county, limit });
  return Response.json({ ok: res.ok, properties: res.ok ? res.data : [], error: res.ok ? null : res.error });
}

export async function POST(req) {
  const body = await req.json();
  const { address, lat, lng, county, city, zip, parcelId, ownerName } = body || {};
  if (!address) return Response.json({ ok: false, error: "address required" }, { status: 400 });
  const res = await findOrCreateProperty({ address, lat, lng, county, city, zip, parcelId, ownerName });
  if (!res.ok) return Response.json(res, { status: res.notConfigured ? 200 : 500 });
  return Response.json(res);
}
