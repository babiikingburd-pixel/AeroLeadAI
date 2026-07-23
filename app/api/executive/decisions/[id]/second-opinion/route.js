import { Boardroom } from "../../../../../../lib/executive/boardroom";
import { AeroLeadAIAdapter } from "../../../../../../lib/executive/adapter";
import { createExecutiveAIClient, activeProvider } from "../../../../../../lib/executive/aiClient";

export const maxDuration = 60;

export async function POST(req, { params }) {
  if (!activeProvider()) {
    return Response.json({ ok: false, error: "No AI provider configured." }, { status: 400 });
  }
  try {
    const boardroom = new Boardroom({ dataAdapter: new AeroLeadAIAdapter(), aiClient: createExecutiveAIClient() });
    const result = await boardroom.requestSecondOpinion(params.id);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
