// Property Intelligence Engine — combines aerial imagery, weather, permits,
// roof measurements, and AI damage detection (all already fetched
// elsewhere in the app) into one property profile: a free, instant,
// deterministic replacement-cost estimate, risk score, and lead
// qualification — no AI call needed for these three, unlike the AI-based
// /api/lead-score panel this complements rather than duplicates.
//
// Parcel data (lot boundaries, ownership records, zoning) is NOT included —
// that needs a county GIS API, which varies by jurisdiction and is a vendor/
// business decision, not something to fake with placeholder polygons.

// Rough regional-average material cost per sqft (materials + labor,
// mid-range), used only as an order-of-magnitude estimate for triage — not
// a quote. Real pricing varies by region, pitch, tear-off layers, and
// current material costs; label this everywhere as a rough estimate.
const COST_PER_SQFT = {
  asphalt: 5.5,
  architectural_asphalt: 7,
  metal: 11,
  tile: 14,
  slate: 20,
  wood_shake: 9,
  flat_membrane: 6.5,
  unknown: 7,
};

const PITCH_MULTIPLIER = { low: 1, moderate: 1.15, steep: 1.35, unknown: 1.1 };

export function estimateReplacementCost({ areaSqft, roofType, pitch }) {
  if (!areaSqft || areaSqft <= 0) {
    return { estimateUsd: null, low: null, high: null, note: "No roof area available — run AI roof measurement or enter square footage manually." };
  }
  const key = (roofType || "unknown").toLowerCase().replace(/[^a-z]/g, "_");
  const perSqft = COST_PER_SQFT[key] ?? COST_PER_SQFT.unknown;
  const mult = PITCH_MULTIPLIER[pitch] ?? PITCH_MULTIPLIER.unknown;
  const mid = Math.round(areaSqft * perSqft * mult);
  return {
    estimateUsd: mid,
    low: Math.round(mid * 0.8),
    high: Math.round(mid * 1.25),
    note: "Rough order-of-magnitude estimate from regional average $/sqft — not a quote. Get a measured takeoff for anything customer-facing.",
  };
}

// Deterministic 0-100 risk score blending signals already on hand — free
// and instant, meant as a pre-filter before spending an AI call on the
// fuller /api/lead-score analysis.
export function computeRiskScore({ damageScore, freezeThawSignal, activeWinterAlerts, permitWithin10y, buildingAge, roofPitch }) {
  const reasons = [];
  let score = 0;

  if (typeof damageScore === "number") {
    score += damageScore * 0.6;
    if (damageScore >= 50) reasons.push(`AI damage score ${damageScore}`);
  }
  if (freezeThawSignal) { score += 12; reasons.push("Freeze-thaw cycling detected (ice-dam risk)"); }
  if (activeWinterAlerts?.length) { score += 10; reasons.push(`Active winter alert: ${activeWinterAlerts[0]}`); }
  if (typeof buildingAge === "number" && buildingAge >= 20) { score += Math.min(15, (buildingAge - 20) * 0.75); reasons.push(`Building age ${buildingAge}y`); }
  if (roofPitch === "low") { score += 5; reasons.push("Low-slope roof holds water/snow longer"); }
  if (permitWithin10y) { score -= 25; reasons.push("Recent roofing permit on file — likely already addressed"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 75 ? "severe" : score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  return { score, level, reasons };
}

// Auto lead qualification — a cheap, instant threshold gate for "does this
// lead deserve a sales call right now," independent of the AI lead-score
// call (which costs an API request and is meant for leads that already
// pass this gate).
export function qualifyLead({ riskScore, permitWithin10y, hasImagery, hasCoordinates }) {
  const reasons = [];
  if (permitWithin10y) return { qualified: false, tier: "excluded", reasons: ["Recent permit on file — deprioritized per the 10-year rule"] };
  if (!hasCoordinates) return { qualified: false, tier: "incomplete", reasons: ["No coordinates — can't fetch imagery/weather yet"] };
  if (!hasImagery) return { qualified: false, tier: "incomplete", reasons: ["No imagery scored yet — run the pipeline first"] };

  if (riskScore >= 60) { reasons.push(`Risk score ${riskScore} — strong candidate`); return { qualified: true, tier: "priority", reasons }; }
  if (riskScore >= 30) { reasons.push(`Risk score ${riskScore} — worth a call`); return { qualified: true, tier: "standard", reasons }; }
  reasons.push(`Risk score ${riskScore} — low urgency`);
  return { qualified: false, tier: "low-priority", reasons };
}

// Convenience: build the full profile from whatever the caller already has
// on hand (a leadStore lead plus optional weather/measurement responses).
export function buildPropertyProfile(lead, { weather, measurement } = {}) {
  const risk = computeRiskScore({
    damageScore: lead.findingsScore,
    freezeThawSignal: weather?.freezeThawSignal,
    activeWinterAlerts: weather?.activeWinterAlerts,
    permitWithin10y: lead.lowPriority,
    buildingAge: lead.buildingAge,
    roofPitch: measurement?.estimated_pitch,
  });
  const cost = estimateReplacementCost({
    areaSqft: measurement?.estimated_area_sqft,
    roofType: lead.roofType,
    pitch: measurement?.estimated_pitch,
  });
  const qualification = qualifyLead({
    riskScore: risk.score,
    permitWithin10y: lead.lowPriority,
    hasImagery: !!(lead.imagery && lead.imagery.length),
    hasCoordinates: !!(lead.lat && lead.lon),
  });
  return { risk, cost, qualification };
}
