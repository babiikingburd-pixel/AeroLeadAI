import { Boardroom } from "../../../../../lib/executive/boardroom";
import { AeroLeadAIAdapter } from "../../../../../lib/executive/adapter";
import { createExecutiveAIClient } from "../../../../../lib/executive/aiClient";

export async function GET(req, { params }) {
  try {
    const boardroom = new Boardroom({ dataAdapter: new AeroLeadAIAdapter(), aiClient: createExecutiveAIClient() });
    const decision = await boardroom.getDecision(params.id);
    if (!decision) return Response.json({ ok: false, error: "Decision not found." }, { status: 404 });
    return Response.json({ ok: true, decision });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
