import { getTop10Opportunities } from "../../../../lib/opportunityCommand";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(10, Math.max(1, Number(searchParams.get("limit")) || 10));
  const result = await getTop10Opportunities({ limit });
  return Response.json(result, { status: result.ok ? 200 : 503 });
}
