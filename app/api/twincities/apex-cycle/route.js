import { supabaseServer } from "../../../../lib/supabaseServer";
// Ranking 152K rows takes well over 60s on a cold cache; the function itself
// carries a 240s statement_timeout for the same reason.
export const maxDuration=300;
function auth(req){const s=process.env.CRON_SECRET;if(!s)return true;return req.headers.get("authorization")===`Bearer ${s}`||new URL(req.url).searchParams.get("secret")===s;}
export async function POST(req){
 if(!auth(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
 const sb=supabaseServer();if(!sb)return Response.json({ok:false,error:"Supabase not configured"},{status:500});
 let body={};try{body=await req.json()}catch{}
 const topN=Math.min(Math.max(Number(body.topN)||500,50),500);
 const cycleId=`APEX10-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
 const {data,error}=await sb.rpc("apex10_rebuild_leaderboard",{p_cycle_id:cycleId,p_limit:topN});
 if(error)return Response.json({ok:false,error:error.message,cycleId},{status:500});
 // The engine can decline: twincities_apex_controls.enabled gates it, and the
 // daily promotion cap can leave qualifying leads held.
 if(data&&data.skipped)return Response.json({ok:false,version:"APEX10.1",cycleId,...data},{status:409});
 return Response.json({ok:true,version:"APEX10.1",cycleId,...(data||{})});
}
