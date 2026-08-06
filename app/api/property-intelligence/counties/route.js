// Item #10: self-expansion loop tracking. This doesn't auto-import parcels
// (that's a per-county data-source decision) — it's the ledger that turns
// "add a county" into a status you can see, instead of tribal knowledge.

import { supabaseGet, supabasePost, supabasePatch } from "../../../../lib/supabaseRest";

export async function GET() {
  const res = await supabaseGet("counties?select=*&order=created_at.desc");
  return Response.json({ ok: res.ok, counties: res.ok ? res.data : [], error: res.ok ? null : res.error });
}

// body: { name, state } to add a new pending county, or
//       { name, state, status, parcelCount } to update an existing one's progress
export async function POST(req) {
  const body = await req.json();
  const { name, state, status, parcelCount } = body || {};
  if (!name || !state) return Response.json({ ok: false, error: "name and state required" }, { status: 400 });

  const existing = await supabaseGet(`counties?name=eq.${encodeURIComponent(name)}&state=eq.${encodeURIComponent(state)}&select=*&limit=1`);
  if (existing.ok && existing.data?.length) {
    const patch = {};
    if (status) patch.status = status;
    if (parcelCount != null) patch.parcel_count = parcelCount;
    if (status === "active") patch.activated_at = new Date().toISOString();
    const updated = await supabasePatch(`counties?county_id=eq.${existing.data[0].county_id}`, patch);
    return Response.json(updated);
  }

  const created = await supabasePost("counties", [{ name, state, status: status || "pending", parcel_count: parcelCount || 0 }]);
  return Response.json(created);
}
