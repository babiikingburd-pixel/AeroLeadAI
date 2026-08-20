import { runNurtureSweep } from "../../../../lib/marketing/campaigns";
export const dynamic = "force-dynamic";

// Call on a schedule (e.g. Vercel Cron, daily) to nudge non-responding leads.
export async function POST() {
  try {
    return Response.json({ ok: true, ...(await runNurtureSweep()) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
