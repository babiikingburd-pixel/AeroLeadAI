import { getProperty } from "../../../../../lib/properties";
import { getTimeline } from "../../../../../lib/timeline";
import { getPropertyGraph } from "../../../../../lib/graph";
import { getRecentChanges } from "../../../../../lib/changeDetector";
import { getPredictions } from "../../../../../lib/predictions";
import { getOutcomes } from "../../../../../lib/outcomes";
export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { id } = params;
  const [property, timeline, graph, changes, predictions, outcomes] = await Promise.all([
    getProperty(id), getTimeline(id), getPropertyGraph(id), getRecentChanges(id), getPredictions(id), getOutcomes(id),
  ]);

  if (!property.ok || !property.property) {
    return Response.json({ ok: false, error: property.error || "property not found" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    property: property.property,
    timeline: timeline.ok ? timeline.data : [],
    graph: graph.ok ? { direct: graph.directEdges, secondHop: graph.secondHopEdges } : { direct: [], secondHop: [] },
    changes: changes.ok ? changes.data : [],
    predictions: predictions.predictions,
    predictionReasons: predictions.reasons,
    outcomes: outcomes.ok ? outcomes.data : [],
  });
}
