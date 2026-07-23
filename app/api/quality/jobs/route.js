import { auditCompletedJob, getFlaggedJobs } from "../../../../lib/quality/audit";
import { isValidImagePayload } from "../../../../lib/validate";

export async function GET() {
  try {
    return Response.json({ ok: true, flagged: await getFlaggedJobs() });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { jobId, base64Image, mediaType } = await req.json();
    if (!jobId || !isValidImagePayload(base64Image, mediaType)) {
      return Response.json({ ok: false, error: "jobId and a valid after-photo are required." }, { status: 400 });
    }
    const result = await auditCompletedJob(jobId, { base64Image, mediaType });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
