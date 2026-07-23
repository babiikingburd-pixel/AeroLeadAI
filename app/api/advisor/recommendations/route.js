import { recommendRecruitmentTargets, recommendMarketEntry, recommendHighestROIOpportunities } from "../../../../lib/advisor/strategicAdvisor";

export async function GET() {
  try {
    const [recruitment, marketEntry, roi] = await Promise.all([
      recommendRecruitmentTargets(), recommendMarketEntry(), recommendHighestROIOpportunities(),
    ]);
    return Response.json({ ok: true, recruitment, marketEntry, roi });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
