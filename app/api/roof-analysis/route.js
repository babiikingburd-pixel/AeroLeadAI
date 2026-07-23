import { analyzeRoof } from "../../../lib/ai/roofAnalysis";
import { isValidLatLon } from "../../../lib/validate";

export async function POST(req) {
  try {
    const { address, lat, lon } = await req.json();
    if (!isValidLatLon(lat, lon)) {
      return Response.json({ error: "Valid lat/lon required." }, { status: 400 });
    }
    const result = await analyzeRoof({ address, lat: Number(lat), lon: Number(lon) });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
