import { supabaseServer } from "../../../../lib/supabaseServer";

function clamp(n){ return Math.max(0,Math.min(100,n)); }

export async function POST(req){
 const supabase=supabaseServer();
 if(!supabase) return Response.json({ok:false,error:"Supabase not configured."},{status:500});
 const {propertyId}=await req.json().catch(()=>({}));
 if(!propertyId) return Response.json({ok:false,error:"propertyId required"},{status:400});

 const {data:p,error}=await supabase.from("batch_leads").select("*").eq("id",propertyId).maybeSingle();
 if(error) return Response.json({ok:false,error:error.message},{status:500});
 if(!p) return Response.json({ok:false,error:"Property not found"},{status:404});

 const completeness=Number(p.evidence_completeness)||0;
 const confidence=Number(p.evidence_confidence)||0;
 const hazard=Number(p.hazard_score)||0;
 const tree=Number(p.tree_hazard_score)||0;
 const utility=Number(p.utility_hazard_score)||0;
 const maintenance=clamp((100-completeness)*.25 + hazard*.35 + tree*.2 + utility*.2);
 const necessity=clamp(hazard*.55 + tree*.2 + utility*.15 + (100-completeness)*.1);
 const opportunity=clamp((Number(p.priority_score)||0)*.55 + maintenance*.25 + necessity*.2);
 const horizon=necessity>=75?"0–6 months":necessity>=55?"6–12 months":necessity>=35?"12–24 months":"24+ months";
 const predictionConfidence=clamp(confidence*.7 + completeness*.3);

 const prediction={
  maintenance:{score:maintenance,horizon,statement: maintenance>=65?"Elevated probability of near-term exterior maintenance need.":"No strong near-term maintenance signal from currently available evidence."},
  safety:{score:necessity,horizon,statement: necessity>=70?"Potential elevated maintenance/safety necessity; professional verification may be appropriate.":"No elevated necessity signal established from current evidence."},
  opportunity:{score:opportunity,horizon,statement: opportunity>=70?"High property-service opportunity based on current evidence and priority signals.":"Opportunity signal is currently moderate or low."},
  confidence:predictionConfidence,
  version:"APEX14.0"
 };

 await supabase.from("batch_leads").update({
  maintenance_prediction:prediction.maintenance,
  safety_prediction:prediction.safety,
  opportunity_prediction:prediction.opportunity,
  maintenance_horizon:horizon,
  necessity_score:necessity,
  opportunity_score:opportunity,
  prediction_confidence:predictionConfidence,
  prediction_version:"APEX14.0"
 }).eq("id",propertyId);

 const rows=[
  ["maintenance",prediction.maintenance],
  ["safety",prediction.safety],
  ["opportunity",prediction.opportunity]
 ].map(([type,x])=>({property_id:propertyId,prediction_type:type,horizon,prediction:x.statement,probability:x.score,urgency:necessity,opportunity:opportunity,confidence:predictionConfidence,model_version:"APEX14.0"}));
 await supabase.from("property_predictions").insert(rows);

 return Response.json({ok:true,propertyId,prediction});
}
