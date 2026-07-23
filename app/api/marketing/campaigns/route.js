import { launchCampaign, listCampaigns, proposeBudgetReallocation } from "../../../../lib/marketing/campaigns";

export async function GET(req) {
  const wantReallocation = new URL(req.url).searchParams.get("reallocation");
  try {
    if (wantReallocation) return Response.json({ ok: true, ...(await proposeBudgetReallocation()) });
    return Response.json({ ok: true, campaigns: await listCampaigns() });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const campaign = await launchCampaign(body);
    return Response.json({ ok: true, campaign });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
