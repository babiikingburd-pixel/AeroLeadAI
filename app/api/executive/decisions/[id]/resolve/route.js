import { Boardroom } from "../../../../../../lib/executive/boardroom";
import { AeroLeadAIAdapter } from "../../../../../../lib/executive/adapter";
import { createExecutiveAIClient } from "../../../../../../lib/executive/aiClient";

export async function POST(req, { params }) {
  try {
    const { approved, rationale } = await req.json();
    if (typeof approved !== "boolean" || !rationale) {
      return Response.json({ ok: false, error: "approved (boolean) and rationale are required." }, { status: 400 });
    }
    const boardroom = new Boardroom({ dataAdapter: new AeroLeadAIAdapter(), aiClient: createExecutiveAIClient() });
    const decision = await boardroom.resolveByHuman(params.id, { approved, rationale });
    return Response.json({ ok: true, decision });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
