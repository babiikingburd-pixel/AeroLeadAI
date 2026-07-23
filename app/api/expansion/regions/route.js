import { startRegionLaunch, listRegionLaunches, completeChecklistStep } from "../../../../lib/expansion/playbook";

export async function GET() {
  try {
    return Response.json({ ok: true, launches: await listRegionLaunches() });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (body.step) {
      const result = await completeChecklistStep(body.regionLaunchId, body.step, body.notes);
      return Response.json({ ok: true, ...result });
    }
    const launch = await startRegionLaunch(body);
    return Response.json({ ok: true, launch });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
