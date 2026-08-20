import { supabaseServer } from "../../../../../lib/supabaseServer";
export const dynamic = "force-dynamic";

function fallbackImage(lat, lon) {
  if (lat == null || lon == null) return null;
  const d = 0.0008;
  return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon-d},${lat-d},${lon+d},${lat+d}&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&f=image`;
}
function statusLabel(v="new") {
  return ({new:"New",contacted:"Contacted",estimate_scheduled:"Quoted",quoted:"Quoted",won:"Won",lost:"Lost"})[v] || "New";
}
export async function GET(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ok:false,error:"Supabase not configured",leads:[]},{status:503});
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 100, 1), 500);
  const { data: rows, error } = await supabase.from("batch_leads")
    .select("id,address,city,state,zip,county,lat,lon,owner,notes,sales_status,year_built,priority_score,evidence_score,confidence_score,hail_inches,wind_mph,review_status")
    .neq("review_status","rejected").gt("priority_score",0)
    .order("priority_score",{ascending:false}).limit(limit);
  if (error) return Response.json({ok:false,error:error.message,leads:[]},{status:500});

  const ids=(rows||[]).map(x=>x.id);
  const imageMap=new Map();
  if(ids.length){
    const {data:imgs}=await supabase.from("property_images")
      .select("property_id,image_url,enhanced_image_url,original_image_url,fetched_at")
      .in("property_id",ids).order("fetched_at",{ascending:false});
    for(const img of imgs||[]) if(!imageMap.has(img.property_id)) imageMap.set(img.property_id,img.enhanced_image_url||img.image_url||img.original_image_url||null);
  }
  const leads=(rows||[]).map(r=>{
    const cached=imageMap.get(r.id)||null;
    const imageUrl=cached||fallbackImage(r.lat,r.lon);
    const storm=Math.min(100,Math.round(Math.max(Number(r.hail_inches||0)*28,Number(r.wind_mph||0))));
    return {
      id:String(r.id), address:r.address||"Unknown address", city:r.city||"", state:r.state||"MN", zip:r.zip||"", county:r.county||"",
      lat:r.lat, lon:r.lon, owner:r.owner||"", notes:r.notes||"", status:statusLabel(r.sales_status), roofYear:r.year_built||null,
      priorityScore:Math.round(Number(r.priority_score||0)), evidenceScore:Math.round(Number(r.evidence_score||0)),
      confidenceScore:Math.round(Number(r.confidence_score||0)), stormExposure:storm, replacementProbability:Math.round(Number(r.priority_score||0)),
      nextAction:r.sales_status==="won"?"Schedule":r.sales_status==="contacted"?"Follow up":"Contact owner",
      imageUrl, imageIsFallback:!cached, source:"supabase"
    };
  });
  return Response.json({ok:true,source:"supabase",total:leads.length,leads});
}
