import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` ||
    new URL(req.url).searchParams.get("secret") === secret;
}

export async function POST(req) {
  if (!auth(req)) return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});

  const origin = new URL(req.url).origin;
  const headers = {"Content-Type":"application/json", ...(process.env.CRON_SECRET ? {Authorization:`Bearer ${process.env.CRON_SECRET}`} : {})};
  const r = await fetch(`${origin}/api/twincities/top500-network`, {
    method:"POST", headers, body:JSON.stringify({mode:"rebalance"})
  });
  const data = await r.json().catch(()=>({ok:false,error:`HTTP ${r.status}`}));
  if (!r.ok) return Response.json(data,{status:r.status});

  const {data:slots,error} = await supabase.from("top500_slots")
    .select("slot_no,property_id,rank,score,status,residential_confidence,last_investigated_at,next_investigation_at")
    .order("slot_no").limit(500);
  if(error) return Response.json({ok:false,error:error.message},{status:500});

  return Response.json({
    ok:true,
    version:"APEX14.1",
    ...data,
    residentialTop500:slots||[],
    contractorReadySlots:(slots||[]).filter(s=>s.status==="occupied").length
  });
}

export async function GET(req) {
  const supabase = supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const {data:slots,error}=await supabase.from("top500_slots").select("*").order("slot_no").limit(500);
  return Response.json({ok:!error,version:"APEX14.1",slots:slots||[],error:error?.message||null});
}
