import { runMonitoringSweep } from "../../../../lib/growth/recruiter";

// Call on a schedule (e.g. Vercel Cron) to suspend contractors whose
// insurance has lapsed or whose job outcomes have cratered.
export async function POST() {
  try {
    return Response.json({ ok: true, ...(await runMonitoringSweep()) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
