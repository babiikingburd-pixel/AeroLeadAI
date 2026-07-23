import { getFinancialReport } from "../../../../lib/financial/financialServices";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const endDate = searchParams.get("endDate") || new Date().toISOString();
  const startDate = searchParams.get("startDate") || new Date(Date.now() - 90 * 86400000).toISOString();
  try {
    return Response.json({ ok: true, ...(await getFinancialReport({ startDate, endDate })) });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
