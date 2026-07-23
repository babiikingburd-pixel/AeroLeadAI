import { verifySignature, applyCallOutcome } from "../../../../lib/bland/webhook";

export async function POST(req) {
  try {
    if (!verifySignature(req.headers.get("x-bland-webhook-secret"))) {
      return Response.json({ error: "Invalid webhook secret." }, { status: 401 });
    }
    const payload = await req.json();
    const result = await applyCallOutcome(payload);
    if (!result.ok) return Response.json(result, { status: 200 }); // 200 so Bland doesn't retry-storm on a data issue
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}
