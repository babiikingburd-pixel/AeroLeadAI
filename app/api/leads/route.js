import { supabaseServer } from "../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit"), 10) || 50, 200);
    const supabase = supabaseServer();
    if (!supabase) return Response.json({ success: false, error: "Supabase service role is not configured.", leads: [] }, { status: 500 });
    const { data: leads, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return Response.json({ success: true, leads });
  } catch (e) {
    return Response.json({ success: false, error: e.message, leads: [] }, { status: 500 });
  }
}
