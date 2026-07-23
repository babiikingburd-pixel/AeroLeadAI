import { Boardroom } from "../../../../lib/executive/boardroom";
import { AeroLeadAIAdapter } from "../../../../lib/executive/adapter";
import { createExecutiveAIClient, activeProvider } from "../../../../lib/executive/aiClient";

// The full negotiation (up to 3 rounds x 6 agents, some sequential) can take
// a while — same reasoning as /api/discover and /api/zip-scan's extended
// maxDuration for multi-call AI routes.
export const maxDuration = 60;

export async function GET(req) {
  const status = new URL(req.url).searchParams.get("status") || undefined;
  try {
    const boardroom = new Boardroom({ dataAdapter: new AeroLeadAIAdapter(), aiClient: createExecutiveAIClient() });
    const decisions = await boardroom.listDecisions(status ? { status } : undefined);
    return Response.json({ ok: true, decisions });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  if (!activeProvider()) {
    return Response.json({ ok: false, error: "No AI provider configured. Set GROQ_API_KEY (free) or ANTHROPIC_API_KEY." }, { status: 400 });
  }
  try {
    const { id, question, proposedAction, dependsOn, dryRun } = await req.json();
    if (!id || !question || !proposedAction) {
      return Response.json({ ok: false, error: "id, question, and proposedAction are required." }, { status: 400 });
    }
    const boardroom = new Boardroom({
      dataAdapter: new AeroLeadAIAdapter(),
      aiClient: createExecutiveAIClient(),
      dryRun: dryRun !== false, // dry-run by default — nothing "executes" against the business until explicitly turned off
    });
    const decision = await boardroom.proposeDecision({ id, question, proposedAction, dependsOn: dependsOn || null });
    return Response.json({ ok: true, decision });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
