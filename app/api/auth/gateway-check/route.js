import { NextResponse } from "next/server";
import { verifyGatewaySignature } from "../../../../lib/security/accessSession";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const secret = process.env.AEROLEAD_SESSION_SECRET || process.env.INTERNAL_API_KEY || "";
  const timestamp = request.headers.get("x-aerolead-gateway-timestamp") || "";
  const method = request.headers.get("x-aerolead-gateway-method") || "";
  const target = request.headers.get("x-aerolead-gateway-target") || "";
  const suppliedSignature = request.headers.get("x-aerolead-gateway-signature") || "";
  const authorized = await verifyGatewaySignature(secret, timestamp, method, target, suppliedSignature);
  return NextResponse.json({ ok: authorized }, { status: authorized ? 200 : 401 });
}
