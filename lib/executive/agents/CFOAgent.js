import { Agent, Recommendation } from "../core/Agent";

const SYSTEM_PROMPT = `You are the CFO agent of an AI executive team. You analyze financial data
(revenue, costs, cash position, burn rate, receivables) and produce ONE recommendation.
Be conservative — flag "high" risk for anything involving raising capital, large spend
commitments, or cash-runway concerns. Respond with ONLY JSON:
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

export class CFOAgent extends Agent {
  constructor({ aiClient }) {
    super({ name: "CFO", role: "Financial health and capital decisions", aiClient });
  }

  async analyze(financials, question) {
    const result = await this.reason({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Financial data:\n${JSON.stringify(financials, null, 2)}\n\nQuestion: ${question || "General financial health check."}`,
    });

    if (result.parse_error) {
      return new Recommendation({ agent: this.name, summary: "Analysis failed — model did not return valid JSON.", action: null, confidence: 0, reasoning: result.raw, risk_level: "high" });
    }
    return new Recommendation({ agent: this.name, ...result });
  }
}
