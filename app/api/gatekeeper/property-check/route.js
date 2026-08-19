import { getLeadById } from "../../../../lib/v22max/dataSource";
import { supabaseAdmin, supabase } from "../../../../lib/supabase";
import { evaluateLead, APEX16_VERSION } from "../../../../lib/gatekeeper16";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ success: false, error: "id required" }, { status: 400 });

  const { row, dataMode, table } = await getLeadById(id);
  if (!row) return Response.json({ success: false, error: "property not found", dataMode }, { status: 404 });

  let images = [];
  const client = supabaseAdmin || supabase;
  if (client) {
    const { data } = await client
      .from("property_images")
      .select("*")
      .eq("property_id", id)
      .order("fetched_at", { ascending: false })
      .limit(10);
    images = data || [];
  }

  return Response.json({
    success: true,
    gatekeeper: APEX16_VERSION,
    dataMode,
    table,
    property: { id: row.id, address: row.address },
    decision: evaluateLead(row, images),
    images: images.length
  });
}
