import { recordSatisfaction } from "../../../../lib/quality/audit";

export async function POST(req) {
  try {
    const { jobId, score, comment } = await req.json();
    if (!jobId || typeof score !== "number" || score < 1 || score > 5) {
      return Response.json({ ok: false, error: "jobId and a score (1-5) are required." }, { status: 400 });
    }
    await recordSatisfaction(jobId, { score, comment });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
