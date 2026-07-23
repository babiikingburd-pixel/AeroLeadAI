import { getOrCreateProperty, getPropertyTimeline, appendHistory } from "../../../../lib/property/propertyRecord";

export async function GET(req) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ ok: false, error: "id required" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await getPropertyTimeline(id)) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 404 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (body.event) {
      const history = await appendHistory(body.propertyId, body.event);
      return Response.json({ ok: true, history });
    }
    const property = await getOrCreateProperty(body);
    return Response.json({ ok: true, property });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
