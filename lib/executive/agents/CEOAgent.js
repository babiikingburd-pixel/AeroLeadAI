import { Agent } from "../core/Agent";
import { CFOAgent } from "./CFOAgent";
import { COOAgent } from "./COOAgent";
import { CMOAgent } from "./CMOAgent";
import { CLOAgent } from "./CLOAgent";
import { CSOAgent } from "./CSOAgent";
import { FifthBusinessAgent } from "./FifthBusinessAgent";
import { Governance, MAX_VOTING_ROUNDS } from "../core/Governance";

const SYNTHESIS_PROMPT = `You are the CEO agent of an AI executive team. You've received
recommendations from your CFO, COO, CMO, CLO, and CSO. Synthesize them into ONE clear
executive summary for the human founder: what's the situation, where do the agents agree
or disagree, and what's your synthesized recommendation. Do not just repeat each agent's
output — actually integrate them. If agents conflict, say so explicitly rather than picking
a side silently. Respond with ONLY JSON:
{
  "executive_summary": string,
  "areas_of_agreement": [string],
  "areas_of_conflict": [string],
  "synthesized_recommendation": string,
  "requires_human_decision": boolean,
  "why_human_needed": string or null
}`;

// The CEO doesn't have its own domain — it convenes the other five, runs
// governance (voting/escalation), and produces one synthesized answer.
//
// Two modes:
// - runSession(question): just a report — no vote, no Fifth Business, fast.
// - runSession(question, { proposedAction }): a real decision — pulls in the
//   Fifth Business as a mandatory dissenter and negotiates until unanimous
//   or escalates to a human after MAX_VOTING_ROUNDS.
export class CEOAgent extends Agent {
  constructor({ aiClient, dataAdapter, governance }) {
    super({ name: "CEO", role: "Synthesis and final call", aiClient });
    this.dataAdapter = dataAdapter;
    this.governance = governance || new Governance({ dryRun: true });
    this.cfo = new CFOAgent({ aiClient });
    this.coo = new COOAgent({ aiClient });
    this.cmo = new CMOAgent({ aiClient });
    this.clo = new CLOAgent({ aiClient });
    this.cso = new CSOAgent({ aiClient });
    this.fifthBusiness = new FifthBusinessAgent({ aiClient });
  }

  async runSession(question, { proposedAction } = {}) {
    const [financials, ops, marketing, legal, strategy] = await Promise.all([
      this.dataAdapter.getFinancials(),
      this.dataAdapter.getOperationsMetrics(),
      this.dataAdapter.getMarketingMetrics(),
      this.dataAdapter.getLegalItems(),
      this.dataAdapter.getStrategicContext(),
    ]);

    const recommendations = await Promise.all([
      this.cfo.analyze(financials, question),
      this.coo.analyze(ops, question),
      this.cmo.analyze(marketing, question),
      this.clo.analyze(legal, question),
      this.cso.analyze(strategy, question),
    ]);

    const synthesis = await this.reason({
      systemPrompt: SYNTHESIS_PROMPT,
      userPrompt: `Founder's question: ${question}\n\nAgent recommendations:\n${JSON.stringify(recommendations, null, 2)}`,
    });

    let negotiation = null;
    if (proposedAction) {
      negotiation = await this._negotiate({ proposedAction, question, baseRecommendations: recommendations });
    }

    return {
      question,
      agent_recommendations: recommendations,
      synthesis: synthesis.parse_error ? { executive_summary: "Synthesis failed to parse.", raw: synthesis.raw } : synthesis,
      negotiation,
    };
  }

  // The actual "4 say yes, Fifth Business says no by default, they negotiate
  // until unanimous" loop. Each round: Fifth Business sees everyone else's
  // case and raises a real objection; if the objection lands, the other
  // agents get a chance to reconsider next round; if Fifth Business runs out
  // of real objections, it flips to yes and the action is unanimously approved.
  async _negotiate({ proposedAction, question, baseRecommendations }) {
    if (this.governance.killSwitchOn) {
      return { unanimous: false, requiresHuman: true, reason: "Kill switch is engaged." };
    }

    let current = baseRecommendations;
    const objectionHistory = [];

    for (let round = 1; round <= MAX_VOTING_ROUNDS; round++) {
      const fifthRec = await this.fifthBusiness.analyze(
        { proposedAction, otherRecommendations: current, priorObjections: objectionHistory },
        question
      );

      const roundRecommendations = [...current, fifthRec];
      const verdict = this.governance.checkUnanimous(roundRecommendations);

      if (fifthRec.objection) objectionHistory.push(`Round ${round}: ${fifthRec.objection}`);

      if (verdict.unanimous) {
        return {
          unanimous: true,
          rounds: round,
          executed: !this.governance.dryRun,
          fifth_business_final: fifthRec,
          objection_history: objectionHistory,
        };
      }

      if (verdict.requiresHuman) {
        return { unanimous: false, requiresHuman: true, reason: verdict.reason, objection_history: objectionHistory };
      }

      if (round < MAX_VOTING_ROUNDS) {
        current = await Promise.all([
          this.cfo.analyze({ ...(await this.dataAdapter.getFinancials()), fifth_business_objection: fifthRec.objection }, question),
          this.coo.analyze({ ...(await this.dataAdapter.getOperationsMetrics()), fifth_business_objection: fifthRec.objection }, question),
          this.cmo.analyze({ ...(await this.dataAdapter.getMarketingMetrics()), fifth_business_objection: fifthRec.objection }, question),
          this.clo.analyze({ ...(await this.dataAdapter.getLegalItems()), fifth_business_objection: fifthRec.objection }, question),
          this.cso.analyze({ ...(await this.dataAdapter.getStrategicContext()), fifth_business_objection: fifthRec.objection }, question),
        ]);
      }
    }

    this.governance.recordEscalation(`No unanimous agreement after ${MAX_VOTING_ROUNDS} rounds`);
    return {
      unanimous: false,
      requiresHuman: true,
      reason: `Fifth Business maintained a real objection through ${MAX_VOTING_ROUNDS} rounds — needs a human decision.`,
      objection_history: objectionHistory,
    };
  }
}
