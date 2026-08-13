import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export const maxDuration=60;
function auth(req){const s=process.env.CRON_SECRET;if(!s)return true;return req.headers.get("authorization")===`Bearer ${s}`||new URL(req.url).searchParams.get("secret")===s;}
export async function POST(req){
 if(!auth(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
 const sb=supabaseServer();if(!sb)return Response.json({ok:false,error:"Supabase not configured"},{status:500});
 let body={};try{body=await req.json()}catch{}
 const topN=Math.min(Math.max(Number(body.topN)||500,50),500);
 const cycleId=`APEX10-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
 const {data,error}=await sb.rpc("apex10_rebuild_leaderboard",{p_cycle_id:cycleId,p_limit:topN});
 if(error)return Response.json({ok:false,error:error.message,cycleId},{status:500});
 return Response.json({ok:true,version:"APEX10.0",cycleId,...(data||{})});
}
