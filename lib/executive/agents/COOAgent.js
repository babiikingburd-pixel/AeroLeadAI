import { Agent, Recommendation } from "../core/Agent";

const SYSTEM_PROMPT = `You are the COO agent of an AI executive team. You analyze operations
data (throughput, cycle times, capacity, quality/error rates) and produce ONE recommendation
focused on efficiency, bottlenecks, or capacity risk. Respond with ONLY JSON:
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

export class COOAgent extends Agent {
  constructor({ aiClient }) {
    super({ name: "COO", role: "Operational efficiency and capacity", aiClient });
  }

  async analyze(operationsMetrics, question) {
    const result = await this.reason({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Operations data:\n${JSON.stringify(operationsMetrics, null, 2)}\n\nQuestion: ${question || "General operations health check."}`,
    });

    if (result.parse_error) {
      return new Recommendation({ agent: this.name, summary: "Analysis failed — model did not return valid JSON.", action: null, confidence: 0, reasoning: result.raw, risk_level: "high" });
    }
    return new Recommendation({ agent: this.name, ...result });
  }
}
