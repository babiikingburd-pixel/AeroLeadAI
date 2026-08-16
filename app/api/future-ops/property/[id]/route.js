import { getProperty } from "../../../../../lib/properties";
import { getTimeline } from "../../../../../lib/timeline";
import { getOutcomes } from "../../../../../lib/outcomes";
import { buildPropertyMission } from "../../../../../lib/commander/propertyCommander";
export const dynamic="force-dynamic";

export async function GET(_req,{params}){
  const id=params.id;
  const [p,t,o]=await Promise.all([getProperty(id),getTimeline(id),getOutcomes(id)]);
  if(!p.ok||!p.property) return Response.json({ok:false,error:p.error||"property not found"},{status:404});
  const property=p.property;
  const context={timeline:t.ok?t.data:[],outcomes:o.ok?o.data:[],images:property.images||property.imagery||[]};
  const mission=buildPropertyMission(property,context);
  return Response.json({ok:true,propertyId:id,futureOps:mission.futureOps,mission});
}
