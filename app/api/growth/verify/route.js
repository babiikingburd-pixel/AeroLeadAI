import { verifyCandidate } from "../../../../lib/growth/recruiter";

export async function POST(req) {
  try {
    const { candidateId } = await req.json();
    if (!candidateId) return Response.json({ ok: false, error: "candidateId required" }, { status: 400 });
    const result = await verifyCandidate(candidateId);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
