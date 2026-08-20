import { supabaseServer } from "../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

export const maxDuration = 60;

const TC_COUNTIES = ["hennepin","ramsey","dakota","scott","carver","anoka"];
const LANES = ["residential","permits","storm","imagery","damage","development","competition"];

function auth(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}` ||
    new URL(req.url).searchParams.get("secret") === secret;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function classifyResidential(row) {
  const explicit = String(row.property_use_type || "").toLowerCase().trim();
  if (/(single.?family|townhome|townhouse|duplex|triplex|fourplex|residential|house|dwelling)/i.test(explicit)) {
    return { status: "verified", confidence: 95, type: explicit || "residential" };
  }
  if (/(apartment|commercial|industrial|office|retail|warehouse|school|church|hospital|hotel|institutional|government)/i.test(explicit)) {
    return { status: "excluded", confidence: 99, type: explicit };
  }

  const permit = Array.isArray(row.permit_history) ? JSON.stringify(row.permit_history) : "";
  const text = [
    row.address, row.notes, row.source,
    ...(Array.isArray(row.tags) ? row.tags : []),
    permit,
  ].filter(Boolean).join(" ").toLowerCase();

  const commercial = /(apartment complex|apartments|commercial|industrial|warehouse|office building|retail|shopping center|hospital|school district|church|hotel|motel|municipal|government building|assisted living)/i;
  const residential = /(single family|single-family|townhome|townhouse|duplex|triplex|fourplex|residential|dwelling|homeowner|house roof|shingle roof|reroof|re-roof)/i;

  if (commercial.test(text)) return { status: "excluded", confidence: 97, type: "non_residential" };
  if (residential.test(text)) return { status: "probable", confidence: 82, type: "residential" };
  return { status: "unknown", confidence: 0, type: null };
}

async function writeFinding(supabase, task, source, claim, evidence, confidence, verification_status="unverified") {
  const { error } = await supabase.from("top500_crawler_findings").insert({
    slot_no: task.slot_no,
    property_id: task.property_id,
    lane_name: task.lane_name,
    source,
    source_ref: evidence?.source_ref || evidence?.permit_number || null,
    claim,
    evidence,
    confidence,
    verification_status,
  });
  return !error;
}

async function finishTask(supabase, task, patch) {
  await supabase.from("top500_crawler_tasks").update({
    status: patch.status || "complete",
    finished_at: new Date().toISOString(),
    result: patch.result || {},
    evidence_written: patch.evidence_written || 0,
    last_error: patch.last_error || null,
    next_run_at: patch.next_run_at || null,
  }).eq("task_id", task.task_id);
}

async function processTask(supabase, task, origin) {
  const { data: row, error } = await supabase.from("batch_leads").select("*").eq("id", task.property_id).maybeSingle();
  if (error || !row) {
    await finishTask(supabase, task, { status: "failed", last_error: error?.message || "Property not found" });
    return { ok:false, lane:task.lane_name, error:error?.message || "Property not found" };
  }

  const address = `${row.address}, ${row.city || ""}, ${row.state || "MN"}`;
  let result = {};
  let evidenceWritten = 0;

  try {
    if (task.lane_name === "residential") {
      const c = classifyResidential(row);
      await supabase.from("batch_leads").update({
        residential_status: c.status,
        residential_confidence: c.confidence,
        property_use_type: c.type,
        top500_evidence_version: "APEX14.1",
        top500_last_investigated_at: new Date().toISOString(),
      }).eq("id", row.id);
      evidenceWritten += await writeFinding(supabase, task, "local:evidence", `Residential classification: ${c.status}`, {
        property_use_type: c.type,
        method: "conservative stored-evidence classifier",
      }, c.confidence, c.status === "verified" ? "verified" : c.status === "excluded" ? "verified_exclusion" : "unverified");
      result = c;
    }

    if (task.lane_name === "permits") {
      const r = await fetch(`${origin}/api/permit-lookup?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(12000) });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(`permit lookup HTTP ${r.status}`);
      const records = Array.isArray(data.records) ? data.records : [];
      const history = records.map(p => ({
        permit_date: p.file_date || p.issue_date || p.date || null,
        permit_number: p.permit_number || p.id || null,
        permit_type: p.permit_type || p.type || null,
        description: p.description || p.scope || null,
        status: p.status || null,
        issuing_jurisdiction: p.jurisdiction || p.city || row.city || null,
        source: data.inDirectory ? "directory" : "permit_lookup",
        evidence_timestamp: new Date().toISOString(),
      }));
      await supabase.from("batch_leads").update({
        permit_history: history,
        permit_history_count: history.length,
        permit_evidence_status: "verified",
        permit_checked_at: new Date().toISOString(),
        permit_evidence: { records: history, checked_at: new Date().toISOString(), source: "top500:permits" },
        permit_within_10y: history.some(p => p.permit_date && Date.now()-new Date(p.permit_date).getTime() <= 3652*86400000),
      }).eq("id", row.id);
      for (const p of history.slice(0, 100)) {
        evidenceWritten += await writeFinding(supabase, task, "permit_lookup", "Permit history record", p, 90, "verified");
      }
      result = { records: history.length };
    }

    if (task.lane_name === "storm") {
      if (row.lat == null || row.lon == null) throw new Error("Missing coordinates");
      const r = await fetch(`${origin}/api/weather-agent`, {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({lat:row.lat,lon:row.lon,address}),
        signal:AbortSignal.timeout(12000),
      });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
      await supabase.from("batch_leads").update({
        storm_evidence: data,
        weather_evidence: data,
        weather_evidence_status: "verified",
        weather_checked_at: new Date().toISOString(),
        storm_checked_at: new Date().toISOString(),
      }).eq("id", row.id);
      evidenceWritten += await writeFinding(supabase, task, "weather-agent", "Storm/weather evidence refreshed", data, 80, "verified");
      result = { refreshed:true };
    }

    if (task.lane_name === "imagery") {
      if (row.lat == null || row.lon == null) throw new Error("Missing coordinates");
      const r = await fetch(`${origin}/api/imagery-agent`, {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({lat:row.lat,lon:row.lon,address:row.address,leadId:row.id,lite:false,force:true}),
        signal:AbortSignal.timeout(18000),
      });
      const data = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(`imagery HTTP ${r.status}`);
      await supabase.from("batch_leads").update({
        image_evidence_status: "fetched",
        image_fetched_at: new Date().toISOString(),
        visual_evidence: data,
      }).eq("id", row.id);
      evidenceWritten += await writeFinding(supabase, task, "imagery-agent", "Fresh imagery retrieved", {
        provider:data.provider || null,
        image_count:Array.isArray(data.images) ? data.images.length : undefined,
        cached:data.cached === true,
      }, 75, "observed");
      result = { provider:data.provider || null, cached:data.cached === true };
    }

    if (task.lane_name === "damage") {
      if (row.lat == null || row.lon == null) throw new Error("Missing coordinates");
      const imgR = await fetch(`${origin}/api/imagery-agent`, {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({lat:row.lat,lon:row.lon,address:row.address,leadId:row.id,lite:true,force:true}),
        signal:AbortSignal.timeout(18000),
      });
      const img = await imgR.json().catch(()=>({}));
      if (!imgR.ok || !img.dataUrl) throw new Error("No usable imagery returned");
      const match = String(img.dataUrl).match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
      if (!match) throw new Error("Imagery response had no data URL");
      const scoreR = await fetch(`${origin}/api/damage-agent`, {
        method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify({domain:"roof",base64Image:match[2],mediaType:match[1],address,leadId:row.id,top500:true}),
        signal:AbortSignal.timeout(30000),
      });
      const score = await scoreR.json().catch(()=>({}));
      if (!scoreR.ok) throw new Error(`damage-agent HTTP ${scoreR.status}`);
      await supabase.from("batch_leads").update({
        roof_visual_score: Number(score.score ?? score.roofScore ?? row.roof_visual_score ?? 0),
        visual_evidence: {...(row.visual_evidence || {}), damage_analysis:score, damage_checked_at:new Date().toISOString()},
        image_review_status: "verified",
      }).eq("id", row.id);
      evidenceWritten += await writeFinding(supabase, task, "damage-agent", "Roof damage analysis completed", score, Number(score.confidence || 0), "verified");
      result = { score:score.score ?? score.roofScore ?? null, confidence:score.confidence ?? null };
    }

    if (task.lane_name === "development") {
      const permitText = JSON.stringify(row.permit_history || row.permit_evidence || {});
      const text = `${row.address} ${row.notes || ""} ${permitText}`.toLowerCase();
      const signals = [
        /subdivision|plat|townhome|townhouse|development|new construction|multi.?family/.test(text),
        /roofing|reroof|re-roof|siding|exterior/.test(text),
      ];
      const score = (signals[0] ? 70 : 0) + (signals[1] ? 30 : 0);
      await supabase.from("batch_leads").update({development_signal:score}).eq("id",row.id);
      evidenceWritten += await writeFinding(supabase, task, "local:evidence", "Residential development signal evaluated", {signals,score}, score, "observed");
      result = { score, signals };
    }

    if (task.lane_name === "competition") {
      const { data: challengers } = await supabase.from("batch_leads")
        .select("id,priority_score,confidence_score,evidence_completeness,evidence_confidence,residential_status")
        .in("county",TC_COUNTIES).eq("sales_status","new").neq("review_status","rejected")
        .in("residential_status",["verified","probable"])
        .order("priority_score",{ascending:false,nullsFirst:false})
        .limit(520);
      const current = challengers?.find(x=>String(x.id)===String(row.id));
      const rank = current ? challengers.findIndex(x=>String(x.id)===String(row.id))+1 : null;
      const challenger = challengers?.[499];
      const beat = Number(challenger?.priority_score || 0) > Number(row.priority_score || 0);
      if (beat && rank && rank > 500) {
        await supabase.from("batch_leads").update({top500_slot_state:"challenged"}).eq("id",row.id);
      }
      result = {rank, cutoff:Number(challenger?.priority_score || 0), challenged:beat};
    }

    const nextSeconds = task.lane_name === "damage" ? 3600 : task.lane_name === "permits" ? 1800 : 900;
    const next = new Date(Date.now()+nextSeconds*1000).toISOString();
    await finishTask(supabase,task,{status:"complete",evidence_written:evidenceWritten,result,next_run_at:next});
    await supabase.from("batch_leads").update({top500_last_investigated_at:new Date().toISOString(),top500_next_investigation_at:next}).eq("id",row.id);
    return {ok:true,lane:task.lane_name,result,evidenceWritten};
  } catch(e) {
    const next = new Date(Date.now()+Math.min(3600,60*Math.pow(2,Math.min(task.attempts,5)))*1000).toISOString();
    await finishTask(supabase,task,{status:task.attempts>=task.max_attempts ? "failed" : "queued",last_error:e.message,next_run_at:next});
    return {ok:false,lane:task.lane_name,error:e.message};
  }
}

async function rebalance(supabase) {
  // First, determine residential candidates from persisted positive evidence.
  // Unknown properties remain in the background pool and cannot be delivered
  // to residential contractors.
  const {data:candidates,error} = await supabase.from("batch_leads")
    .select("id,address,city,state,county,lat,lon,priority_score,confidence_score,evidence_completeness,evidence_confidence,residential_status")
    .in("county",TC_COUNTIES).eq("sales_status","new").neq("review_status","rejected")
    .in("residential_status",["verified","probable"])
    .order("priority_score",{ascending:false,nullsFirst:false})
    .order("confidence_score",{ascending:false,nullsFirst:false})
    .limit(500);
  if(error) throw new Error(error.message);

  const currentIds = new Set((candidates||[]).map(x=>String(x.id)));
  const {data:slots} = await supabase.from("top500_slots").select("*").order("slot_no",{ascending:true}).limit(500);
  let assigned=0,replaced=0,opened=0;

  for(let i=0;i<500;i++){
    const c=candidates?.[i];
    const old=slots?.[i];
    if(!c){
      if(old?.property_id){
        await supabase.from("batch_leads").update({top500_slot:null,top500_slot_state:"none"}).eq("id",old.property_id);
        await supabase.from("top500_crawler_tasks").update({status:"cancelled"}).eq("slot_no",i+1).in("status",["queued","running"]);
      }
      await supabase.from("top500_slots").upsert({slot_no:i+1,property_id:null,rank:null,status:"open",updated_at:new Date().toISOString()},{onConflict:"slot_no"});
      if(!old?.property_id) opened++;
      continue;
    }
    const changed=!old || String(old.property_id)!==String(c.id);
    if(changed) {
      if(old?.property_id){
        await supabase.from("batch_leads").update({top500_slot:null,top500_slot_state:"none"}).eq("id",old.property_id);
        await supabase.from("top500_crawler_tasks").update({status:"cancelled"}).eq("slot_no",i+1).in("status",["queued","running"]);
        replaced++;
      }
      await supabase.from("batch_leads").update({top500_slot:i+1,top500_slot_state:"active",top500_evidence_version:"APEX14.1"}).eq("id",c.id);
    }
    await supabase.from("top500_slots").upsert({
      slot_no:i+1,property_id:c.id,rank:i+1,score:Number(c.priority_score||0),
      evidence_confidence:Number(c.evidence_confidence||c.confidence_score||0),
      evidence_completeness:Number(c.evidence_completeness||0),
      residential_confidence:Number(c.residential_confidence||0),
      status:"occupied",assigned_at:changed?new Date().toISOString():(old?.assigned_at||new Date().toISOString()),
      last_competed_at:new Date().toISOString(),updated_at:new Date().toISOString()
    },{onConflict:"slot_no"});
    assigned++;
  }
  const {data:ensure} = await supabase.rpc("ensure_top500_crawler_tasks");
  return {assigned,replaced,opened,candidates:candidates?.length||0,tasksEnsured:Number(ensure||0)};
}

export async function POST(req) {
  if(!auth(req)) return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const body=await req.json().catch(()=>({}));
  const mode=body.mode||"cycle";
  try {
    if(mode==="rebalance"){
      const r=await rebalance(supabase);
      return Response.json({ok:true,mode,version:"APEX14.1",...r});
    }

    const workerId=String(body.workerId||`top500-${process.pid}-${Date.now()}`);
    if(mode==="cycle") await rebalance(supabase);
    await supabase.rpc("schedule_due_top500_lanes");
    const {data:tasks,error}=await supabase.rpc("claim_top500_crawler_tasks",{p_worker_id:workerId,p_limit:Math.min(Number(body.limit)||4,8)});
    if(error) return Response.json({ok:false,error:error.message},{status:500});
    const results=[];
    for(const task of tasks||[]) results.push(await processTask(supabase,task,new URL(req.url).origin));
    return Response.json({ok:true,version:"APEX14.1",workerId,claimed:tasks?.length||0,results});
  } catch(e) {
    return Response.json({ok:false,error:e.message},{status:500});
  }
}

export async function GET(req){
  const supabase=supabaseServer();
  if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
  const {data:slots}=await supabase.from("top500_slots").select("*").order("slot_no").limit(500);
  const {data:tasks}=await supabase.from("top500_crawler_tasks").select("status,lane_name,slot_no,attempts,last_error,locked_by,created_at").order("created_at",{ascending:false}).limit(100);
  const {data:findings}=await supabase.from("top500_crawler_findings").select("lane_name,verification_status,created_at").order("created_at",{ascending:false}).limit(100);
  return Response.json({ok:true,version:"APEX14.1",slots:slots||[],recentTasks:tasks||[],recentFindings:findings||[]});
}
