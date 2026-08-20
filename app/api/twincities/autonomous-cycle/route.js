import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic="force-dynamic";
export const maxDuration=60;

function auth(req){const s=process.env.CRON_SECRET,o=req.headers.get("origin")||"",h=req.headers.get("host")||"";if(h&&o&&o.includes(h))return true;if(!s)return true;return req.headers.get("authorization")===`Bearer ${s}`||new URL(req.url).searchParams.get("secret")===s;}
async function cycle(origin,headers,path,body,timeout=18000){
  try{const res=await fetch(`${origin}${path}`,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const data=await res.json().catch(()=>({ok:false,error:`HTTP ${res.status}`}));return{status:res.status,data};}
  catch(e){return{status:0,data:{ok:false,error:e.message,timeout:true}};}
}
export async function POST(req){
  if(!auth(req))return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const db=supabaseServer();if(!db)return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const origin=new URL(req.url).origin,headers={"Content-Type":"application/json",...(process.env.CRON_SECRET?{Authorization:`Bearer ${process.env.CRON_SECRET}`}:{})},cycleStarted=new Date().toISOString();
  // Run independent workers concurrently and deliberately keep each slice small enough for Vercel's 60s ceiling.
  const [scoring,validation,top500Network]=await Promise.all([
    cycle(origin,headers,"/api/twincities/fast-cycle",{scanLimit:400,challengerLimit:250},18000),
    cycle(origin,headers,"/api/twincities/validation-worker",{limit:4},18000),
    cycle(origin,headers,"/api/twincities/top500-network",{mode:"cycle",limit:3,workerId:`cycle-${Date.now()}`},22000),
  ]);
  const {data:top}=await db.from("batch_leads").select("id,priority_score,confidence_score,validation_status").eq("sales_status","new").neq("review_status","rejected").order("priority_score",{ascending:false}).limit(600);
  return Response.json({ok:true,version:"AERO15-RESPONSIVE-CYCLE",cycleStarted,scoring,validation,top500Network,currentTop500:Math.min(top?.length||0,500),currentTop600:top?.length||0,cutoffScore500:top?.[499]?.priority_score??null,cutoffScore600:top?.[599]?.priority_score??null,cycleFinished:new Date().toISOString()});
}
export async function GET(req){return POST(req)}
