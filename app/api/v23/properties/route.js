import { supabaseAdmin, supabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const client = () => supabaseAdmin || supabase;
const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));

function windowFrom(row={}) {
  if (row.maintenance_horizon) return row.maintenance_horizon;
  const p = Number(row.opportunity_score ?? row.priority_score ?? 0);
  if (p >= 80) return "NOW";
  if (p >= 64) return "0-3 MONTHS";
  if (p >= 58) return "3-6 MONTHS";
  if (p >= 49) return "6-12 MONTHS";
  return "WATCH";
}

function normalize(row={}) {
  return {
    ...row,
    display_window: windowFrom(row),
    display_score: Number(row.opportunity_score ?? row.priority_score ?? row.evidence_score ?? 0),
    review_required: Boolean(row.human_review || row.ei_review_required || row.image_review_status === "queued" || row.validation_status === "pending")
  };
}

async function leadsByPriority(limit=5000) {
  const c=client();
  const {data,error}=await c.from("batch_leads").select("*").eq("excluded",false).order("priority_score",{ascending:false,nullsFirst:false}).limit(limit);
  if (error) throw error;
  return (data||[]).map(normalize);
}

async function top500() {
  const c=client();
  const [{data:slots,error:se},{data:fallback,error:fe}] = await Promise.all([
    c.from("top500_slots").select("*").order("rank",{ascending:true}).limit(500),
    c.from("batch_leads").select("*").eq("excluded",false).order("priority_score",{ascending:false,nullsFirst:false}).limit(700)
  ]);
  if (se) throw se; if (fe) throw fe;
  const ids=(slots||[]).map(x=>x.property_id).filter(Boolean);
  let matched=[];
  if(ids.length){const {data,error}=await c.from("batch_leads").select("*").in("id",ids); if(error) throw error; matched=data||[];}
  const byId=new Map(matched.map(r=>[String(r.id),r]));
  const out=[]; const seen=new Set();
  for(const s of slots||[]){const r=byId.get(String(s.property_id)); if(!r) continue; out.push(normalize({...r,top500_rank:s.rank,top500_slot:s.slot_no,top500_slot_state:s.status,top500_slot_score:s.score})); seen.add(String(r.id));}
  for(const r of fallback||[]){if(out.length>=500) break; if(seen.has(String(r.id))) continue; out.push(normalize(r)); seen.add(String(r.id));}
  return out.slice(0,500);
}

async function review100() {
  const rows=await leadsByPriority(2000);
  const review=rows.filter(r=>r.review_required);
  const seen=new Set(review.map(r=>String(r.id)));
  for(const r of rows){if(review.length>=100) break; if(seen.has(String(r.id))) continue; review.push(r); seen.add(String(r.id));}
  return review.slice(0,100);
}

export async function GET(req){
  try{
    const u=new URL(req.url);
    const tab=(u.searchParams.get("tab")||"NOW").toUpperCase();
    const requested=clamp(Number(u.searchParams.get("limit"))||100,1,500);
    let rows=[];
    if(tab==="TOP500") rows=(await top500()).slice(0,requested);
    else if(tab==="REVIEW100") rows=(await review100()).slice(0,requested);
    else {
      const all=await leadsByPriority(5000);
      rows=all.filter(r=>r.display_window===tab).slice(0,requested);
      if(rows.length<requested){const seen=new Set(rows.map(r=>String(r.id))); for(const r of all){if(rows.length>=requested) break; if(seen.has(String(r.id))) continue; rows.push(r); seen.add(String(r.id));}}
    }
    const c=client();
    const [{count:leadCount},{count:imgCount},{count:slotCount},{count:findingCount},{count:leaderCount}] = await Promise.all([
      c.from("batch_leads").select("id",{count:"exact",head:true}),
      c.from("property_images").select("id",{count:"exact",head:true}),
      c.from("top500_slots").select("slot_no",{count:"exact",head:true}),
      c.from("top500_crawler_findings").select("finding_id",{count:"exact",head:true}),
      c.from("territory_leaderboard_current").select("id",{count:"exact",head:true})
    ]);
    return Response.json({success:true,system:"V23 GateKeeper Clean Audit",tab,rows,counts:{leads:leadCount||0,images:imgCount||0,top500Slots:slotCount||0,crawlerFindings:findingCount||0,leaderboardRows:leaderCount||0}});
  }catch(e){return Response.json({success:false,error:e?.message||String(e),rows:[]},{status:500});}
}