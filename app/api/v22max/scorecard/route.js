import {getLeads,getLeadImages} from "../../../../lib/v22max/dataSource";
import {scorecard,V22MAX_VERSION} from "../../../../lib/v22max/leadIntelligence";
import {leadImageCandidates} from "../../../../lib/v22max/imagery";
export const dynamic="force-dynamic";
export const revalidate=0;
export async function GET(request){
  try{
    const u=new URL(request.url),limit=Math.min(Math.max(Number(u.searchParams.get("limit"))||500,1),1000);
    const filters={city:u.searchParams.get("city")||"",county:u.searchParams.get("county")||"",state:u.searchParams.get("state")||"",zip:u.searchParams.get("zip")||""};
    const {rows,dataMode,table,error}=await getLeads(limit,filters);
    const images=await getLeadImages(rows.map(r=>r.id));
    const s=scorecard(rows,null,{rankedLimit:limit});
    s.ranked=s.ranked.map(r=>({...r,image_candidates:leadImageCandidates(r,images[String(r.id)]||[])}));
    s.top=s.ranked.slice(0,10);
    return Response.json({success:true,version:V22MAX_VERSION,dataMode,table:table||null,sourceError:error||null,filters,generatedAt:new Date().toISOString(),...s});
  }catch(e){return Response.json({success:false,version:V22MAX_VERSION,total:0,ranked:[],top:[],error:String((e&&e.message)||e)},{status:500})}
}
