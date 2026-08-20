import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessConfiguration, verifyAccessToken } from "../../../../lib/security/accessSession";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const configuration = accessConfiguration();
  const authenticated = configuration.developmentBypass || (configuration.configured && await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, configuration.sessionSecret));
  return NextResponse.json({ ok: true, authenticated }, { status: authenticated ? 200 : 401 });
}
