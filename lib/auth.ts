import { NextRequest, NextResponse } from "next/server";

// Closes the two open items from 04-SECURITY-NOTES.md:
//  1. "No authentication on any of the three POST endpoints"
//  2. "ALLOWED_ORIGINS=* ... must be locked down to specific origins"

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export function requireApiKey(request: NextRequest): NextResponse | null {
  const key = request.headers.get("x-api-key");
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected) {
    // fail closed if the server itself isn't configured
    return NextResponse.json(
      { error: "Server misconfigured: INTERNAL_API_KEY not set" },
      { status: 500 }
    );
  }

  if (!key || key !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null; // null = authorized, continue
}

export function corsHeaders(origin: string | null): HeadersInit {
  if (origin && allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-api-key",
    };
  }
  // no wildcard fallback — unrecognized origins get no CORS headers at all
  return {};
}
