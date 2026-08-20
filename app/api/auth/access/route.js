import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessCodeAuthorized, accessConfiguration, accessCookieOptions, createAccessToken } from "../../../../lib/security/accessSession";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const configuration = accessConfiguration();
  if (!configuration.configured) {
    return NextResponse.json({ ok: false, error: "Owner access is not configured on the server." }, { status: 503 });
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ ok: false, error: "JSON request required." }, { status: 415 });
  }
  const { code } = await request.json().catch(() => ({}));
  if (!await accessCodeAuthorized(code, configuration)) {
    return NextResponse.json({ ok: false, error: "Invalid access code." }, { status: 401 });
  }

  const token = await createAccessToken(configuration.sessionSecret);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, token, accessCookieOptions());
  return response;
}
