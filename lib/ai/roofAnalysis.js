import { callVisionModel, activeProvider } from "../aiClient";

// Automated roof analysis for the workflow pipeline's ANALYZE stage: unlike
// /api/damage-annotate (which needs a browser to already have an image in
// hand — user uploaded or console-fetched), this pulls its own Google
// Static Maps satellite image from lat/lon so a server-side cron sweep can
// run it with no human present, then adds rough measurements and a
// transparent cost estimate on top. Output damage shape (bounding_box
// object, confidence 0-1) intentionally matches /api/damage-annotate's
// schema so components/RoofAnnotationViewer.jsx works unmodified against
// either source.

const STATIC_MAPS_ZOOM = 20; // close enough for shingle-level detail on most residential lots
const STATIC_MAPS_SIZE = 640; // Google's free-tier max square size

// Baseline $/sqft by severity, before any local-market calibration. Honest
// starting point, not a measured estimate — see README caveats.
const COST_PER_SQFT_BY_SEVERITY = { minor: 4.5, moderate: 7, severe: 11 };

export async function fetchSatelliteImage(lat, lon) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY not configured — roof analysis needs a satellite image source.");
  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lon}&zoom=${STATIC_MAPS_ZOOM}&size=${STATIC_MAPS_SIZE}x${STATIC_MAPS_SIZE}&maptype=satellite&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Static Maps error: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64Image: buf.toString("base64"), mediaType: "image/png" };
}

function buildEstimate(damage, estimatedAreaSqft) {
  if (!damage.length || !estimatedAreaSqft) {
    return { total_usd: null, breakdown: [], caveat: "No damage findings or no area estimate — cannot build a cost estimate." };
  }
  const counts = { minor: 0, moderate: 0, severe: 0 };
  for (const d of damage) counts[d.severity] += 1;
  const breakdown = Object.entries(counts).filter(([, count]) => count > 0)
    .map(([severity, count]) => ({ severity, finding_count: count, rate_per_sqft: COST_PER_SQFT_BY_SEVERITY[severity] }));
  // Highest-severity finding drives the $/sqft rate, applied to a fraction
  // of total roof area proportional to how many findings landed — a rough,
  // explainable heuristic, not a takeoff.
  const worst = damage.reduce((acc, d) => (COST_PER_SQFT_BY_SEVERITY[d.severity] > COST_PER_SQFT_BY_SEVERITY[acc] ? d.severity : acc), "minor");
  const affectedFraction = Math.min(1, damage.length * 0.12); // each distinct finding ~= 12% of the roof, capped at 100%
  const affectedSqft = Math.round(estimatedAreaSqft * affectedFraction);
  const totalUsd = Math.round(affectedSqft * COST_PER_SQFT_BY_SEVERITY[worst]);
  return {
    total_usd: totalUsd,
    breakdown,
    affected_sqft_estimate: affectedSqft,
    caveat: "Rough baseline estimate from finding count/severity and estimated area — recalibrate rate_per_sqft with real completed-job cost data, not a measured takeoff.",
  };
}

export async function analyzeRoof({ address, lat, lon }) {
  if (!activeProvider()) {
    throw new Error("No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY.");
  }
  const { base64Image, mediaType } = await fetchSatelliteImage(lat, lon);

  const prompt = `You are a roof damage assessment AI, conservative and evidence-based: only report
damage you can actually see, and reflect real uncertainty in your confidence scores. You are examining
a satellite image of "${address || "an unspecified property"}".

Identify distinct visible damage findings (missing_shingles, granule_loss, hail_impact,
flashing_damage, ponding_water, structural_sag, moss_algae) AND estimate rough roof measurements.
If you see no damage, return an empty damage array — do not invent findings.

Respond ONLY with JSON, no preamble, no markdown fences:
{
  "damage": [
    { "type": "<one of the types above>", "severity": "minor|moderate|severe", "confidence": <0-1 number>, "description": "<one sentence>", "bounding_box": { "x": <0-1>, "y": <0-1>, "width": <0-1>, "height": <0-1> } }
  ],
  "measurements": {
    "estimated_area_sqft": <integer, rough order of magnitude>,
    "roof_shape": "gable|hip|flat|gambrel|mixed|unknown",
    "estimated_pitch": "low|moderate|steep|unknown"
  },
  "overall_score": <0-100 integer, higher = more concern>,
  "overall_confidence": <0-1 number>
}`;

  const { text, provider } = await callVisionModel({ base64Image, mediaType, prompt });
  const clean = text.replace(/```json|```/g, "").trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = { damage: [], measurements: { estimated_area_sqft: null, roof_shape: "unknown", estimated_pitch: "unknown" }, overall_score: 0, overall_confidence: 0 };
  }

  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));
  const damage = Array.isArray(parsed.damage) ? parsed.damage.map((d) => ({
    type: d.type || "unknown",
    severity: ["minor", "moderate", "severe"].includes(d.severity) ? d.severity : "minor",
    confidence: clamp01(d.confidence),
    description: d.description || "",
    bounding_box: {
      x: clamp01(d.bounding_box?.x), y: clamp01(d.bounding_box?.y),
      width: clamp01(d.bounding_box?.width), height: clamp01(d.bounding_box?.height),
    },
  })) : [];

  const estimate = buildEstimate(damage, parsed.measurements?.estimated_area_sqft);

  return {
    address, lat, lon,
    imageUrl: `data:${mediaType};base64,${base64Image}`, // works directly as RoofAnnotationViewer's `imageUrl` prop
    damage,
    measurements: parsed.measurements || { estimated_area_sqft: null, roof_shape: "unknown", estimated_pitch: "unknown" },
    overall_score: Number.isFinite(parsed.overall_score) ? parsed.overall_score : 0,
    overall_confidence: clamp01(parsed.overall_confidence),
    estimate,
    provider,
    analyzedAt: new Date().toISOString(),
  };
}
