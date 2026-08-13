import { getLeadsFromDB } from "../../../lib/supabase";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit"), 10) || 50, 200);
    const leads = await getLeadsFromDB(limit);
    return Response.json({ success: true, leads });
  } catch (e) {
    return Response.json({ success: false, error: e.message, leads: [] }, { status: 500 });
  }
}
