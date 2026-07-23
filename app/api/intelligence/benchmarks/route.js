import { getContractorBenchmark, getSeasonalDemandPattern, getRegionalDemandBenchmark } from "../../../../lib/intelligence/benchmarks";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const contractorId = searchParams.get("contractorId");
  const domain = searchParams.get("domain");
  const zip = searchParams.get("zip");
  try {
    if (contractorId) return Response.json({ ok: true, ...(await getContractorBenchmark(contractorId)) });
    if (domain) return Response.json({ ok: true, ...(await getSeasonalDemandPattern(domain)) });
    if (zip) return Response.json({ ok: true, ...(await getRegionalDemandBenchmark(zip)) });
    return Response.json({ ok: false, error: "Provide contractorId, domain, or zip." }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}
