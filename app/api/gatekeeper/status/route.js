import { getLeads } from "../../../../lib/v22max/dataSource";
import { evaluateLead, APEX16_VERSION } from "../../../../lib/gatekeeper16";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { rows, dataMode, table } = await getLeads(100);
  const decisions = rows.map((r) => evaluateLead(r));
  const count = (status) => decisions.filter((d) => d.status === status).length;
  const avg = decisions.length ? decisions.reduce((a, d) => a + d.confidence, 0) / decisions.length : 0;
  return Response.json({
    success: true,
    system: "V23 GateKeeper Clean Audit",
    version: "23.0",
    gatekeeperEngine: `APEX${APEX16_VERSION}`,
    baseIntelligence: "V22 MAX",
    dataMode,
    table,
    checkedAt: new Date().toISOString(),
    sample: decisions.length,
    verifiedActionable: count("VERIFIED-ACTIONABLE"),
    verifiedWithCaution: count("VERIFIED-WITH-CAUTION"),
    held: count("HOLD-FOR-VERIFICATION"),
    averageConfidence: Number(avg.toFixed(4)),
    policy: "SOURCE → EVIDENCE → FRESHNESS → CORROBORATION → CONTRADICTION → CONFIDENCE → ACTION"
  });
}
