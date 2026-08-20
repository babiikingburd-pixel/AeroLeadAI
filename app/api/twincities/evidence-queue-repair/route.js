import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req) {
  if (!authorized(req)) return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});

  const staleBefore = new Date(Date.now() - 15*60*1000).toISOString();
  const { data, error } = await supabase
    .from("evidence_queue")
    .update({
      status:"queued",
      locked_at:null,
      last_error:"Recovered stale running job",
      available_at:new Date().toISOString()
    })
    .eq("status","running")
    .lt("locked_at", staleBefore)
    .select("id");

  if (error) return Response.json({ok:false,error:error.message},{status:500});
  return Response.json({ok:true,recovered:data?.length||0});
}
