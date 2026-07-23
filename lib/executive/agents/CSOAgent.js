import { Agent, Recommendation } from "../core/Agent";

const SYSTEM_PROMPT = `You are the CSO (Chief Strategy Officer) agent of an AI executive team.
You analyze strategic context (market position, competitor moves, stated company goals) and
produce ONE recommendation about market entry, competitive response, or prioritization.
Respond with ONLY JSON:
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

export class CSOAgent extends Agent {
  constructor({ aiClient }) {
    super({ name: "CSO", role: "Strategy, competitive positioning, and prioritization", aiClient });
  }

  async analyze(strategicContext, question) {
    const result = await this.reason({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Strategic context:\n${JSON.stringify(strategicContext, null, 2)}\n\nQuestion: ${question || "General strategic health check."}`,
    });

    if (result.parse_error) {
      return new Recommendation({ agent: this.name, summary: "Analysis failed — model did not return valid JSON.", action: null, confidence: 0, reasoning: result.raw, risk_level: "high" });
    }
    return new Recommendation({ agent: this.name, ...result });
  }
}
