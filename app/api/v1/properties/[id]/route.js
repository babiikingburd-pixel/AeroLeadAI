import { verifyApiKey } from "../../../../../lib/platformApi";
import { supabaseServer } from "../../../../../lib/supabaseServer";

/**
 * GET /api/v1/properties/:id
 * Header: Authorization: Bearer alai_xxxxx
 *
 * Reference implementation every other public endpoint should copy: verify
 * key + scope first, scope the query to the caller's org, never return
 * another org's data even if they guess an ID.
 */
export async function GET(req, { params }) {
  const authHeader = req.headers.get("authorization") || "";
  const rawKey = authHeader.replace("Bearer ", "");
  const auth = await verifyApiKey(rawKey, "properties:read");
  if (!auth.valid) return Response.json({ error: auth.reason }, { status: 401 });

  const supabase = supabaseServer();
  if (!supabase) return Response.json({ error: "Supabase not configured." }, { status: 500 });

  const { data, error } = await supabase.from("property_records").select("*").eq("id", params.id).eq("organization_id", auth.organizationId).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Property not found or not accessible with this key" }, { status: 404 });

  return Response.json({ property: data });
}
