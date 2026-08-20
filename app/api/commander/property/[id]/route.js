import { getProperty } from "../../../../../lib/properties";
import { getTimeline } from "../../../../../lib/timeline";
import { getPropertyGraph } from "../../../../../lib/graph";
import { getRecentChanges } from "../../../../../lib/changeDetector";
import { getPredictions } from "../../../../../lib/predictions";
import { getOutcomes } from "../../../../../lib/outcomes";
import { buildPropertyMission } from "../../../../../lib/commander/propertyCommander";
export const dynamic="force-dynamic";

export async function GET(_req,{params}){
  const id=params.id;
  const [p,t,g,c,pr,o]=await Promise.all([getProperty(id),getTimeline(id),getPropertyGraph(id),getRecentChanges(id),getPredictions(id),getOutcomes(id)]);
  if(!p.ok||!p.property) return Response.json({ok:false,error:p.error||'property not found'},{status:404});
  const property=p.property;
  const images=property.images||property.imagery||[];
  const context={timeline:t.ok?t.data:[],graph:g.ok?g:{},changes:c.ok?c.data:[],predictions:pr.predictions||[],outcomes:o.ok?o.data:[],images};
  return Response.json({ok:true,propertyId:id,mission:buildPropertyMission(property,context)});
}
