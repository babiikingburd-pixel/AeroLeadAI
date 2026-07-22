import { callTextModel, activeProvider } from "../../../lib/aiClient";

// AI Lead Scoring & Sales Intelligence: turns a property's raw findings into
// a ranked, sales-facing scorecard — roof age, damage severity, insurance
// claim probability, estimated repair value, priority rank, and a revenue
// forecast note. All numbers are AI estimates from available signals, not a
// substitute for an adjuster or a measured takeoff — the UI labels them as such.
export async function POST(req) {
  try {
    const { address, findingsScore, indicators, notes, buildingAge, roofType, permitWithin10y, weatherSummary, freezeThawSignal } = await req.json();

    if (!activeProvider()) {
      return Response.json({ error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 500 });
    }

    const prompt = `You are the Sales Intelligence Analyst for AeroLeadAI, scoring a roofing lead for a
sales team deciding where to spend time first.

Property: ${address || "unknown address"}
Damage analyst concern score (0-100): ${findingsScore ?? "not yet scored"}
Damage indicators: ${(indicators || []).join(", ") || "none recorded"}
Damage analyst notes: ${notes || "none"}
Building age (years, if known): ${buildingAge || "unknown"}
Roof type (if known): ${roofType || "unknown"}
Recent roofing permit on file (last 10y): ${permitWithin10y ? "yes" : "no"}
Weather signal: ${weatherSummary || "none"}${freezeThawSignal ? " (freeze-thaw cycling detected)" : ""}

Respond ONLY with JSON, no preamble, no markdown fences:
{
  "roof_age_estimate_years": <integer or null if truly unknowable>,
  "damage_severity_score": <0-100 integer>,
  "insurance_claim_probability_pct": <0-100 integer>,
  "estimated_repair_value_usd": <integer, rough order-of-magnitude USD>,
  "lead_priority_rank": "<hot|warm|cool|cold>",
  "revenue_forecast_note": "<one sentence on why/confidence>",
  "reasoning": "<one sentence, the single biggest factor driving this score>"
}`;

    const { text, provider } = await callTextModel({ prompt });
    const clean = text.replace(/```json|```/g, "").trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { parsed = { roof_age_estimate_years: null, damage_severity_score: findingsScore ?? 0, insurance_claim_probability_pct: 0, estimated_repair_value_usd: 0, lead_priority_rank: "cold", revenue_forecast_note: "Could not parse scoring response.", reasoning: "" }; }

    return Response.json({ ...parsed, provider, scoredAt: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
