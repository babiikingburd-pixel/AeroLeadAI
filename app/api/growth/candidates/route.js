import { submitCandidate, listCandidates } from "../../../../lib/growth/recruiter";

export async function GET(req) {
  const status = new URL(req.url).searchParams.get("status") || undefined;
  try {
    return Response.json({ ok: true, candidates: await listCandidates(status) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const candidate = await submitCandidate(body);
    return Response.json({ ok: true, candidate });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
