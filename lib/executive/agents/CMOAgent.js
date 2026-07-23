import { Agent, Recommendation } from "../core/Agent";

const SYSTEM_PROMPT = `You are the CMO agent of an AI executive team. You analyze marketing
data (CAC, channel performance, pipeline, conversion rates) and produce ONE recommendation
about where to shift spend, sharpen messaging, or address a conversion problem. Respond with
ONLY JSON:
{
  "summary": string,
  "action": string or null,
  "confidence": number (0-1),
  "reasoning": string,
  "risk_level": "low" | "medium" | "high",
  "financial_impact": { "amount_cents": number, "direction": "gain" | "loss" | "uncertain" } or null,
  "legal_risk": "low" | "medium" | "high" or null,
  "operational_risk": "low" | "medium" | "high" or null,
  "expected_roi": number or null,
  "rollback_plan": string or null
}`;

export class CMOAgent extends Agent {
  constructor({ aiClient }) {
    super({ name: "CMO", role: "Growth, marketing spend, and brand", aiClient });
  }

  async analyze(marketingMetrics, question) {
    const result = await this.reason({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Marketing data:\n${JSON.stringify(marketingMetrics, null, 2)}\n\nQuestion: ${question || "General growth health check."}`,
    });

    if (result.parse_error) {
      return new Recommendation({ agent: this.name, summary: "Analysis failed — model did not return valid JSON.", action: null, confidence: 0, reasoning: result.raw, risk_level: "high" });
    }
    return new Recommendation({ agent: this.name, ...result });
  }
}
