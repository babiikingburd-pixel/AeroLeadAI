import { getLeads } from "../../../../lib/v22max/dataSource";
import { scorecard, V22MAX_VERSION } from "../../../../lib/v22max/leadIntelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000);
    const halfLifeDays = Number(url.searchParams.get("halfLifeDays")) || 45;
    const { rows, dataMode, table, error } = await getLeads(limit);
    const card = scorecard(rows, null, { halfLifeDays, rankedLimit: limit });
    return Response.json({ success:true, version:V22MAX_VERSION, dataMode, table:table||null, sourceError:error||null, generatedAt:new Date().toISOString(), ...card });
  } catch (e) {
    return Response.json({ success:true, version:V22MAX_VERSION, dataMode:"demo", total:0, windows:{}, ranked:[], top:[], error:String((e&&e.message)||e) });
  }
}
