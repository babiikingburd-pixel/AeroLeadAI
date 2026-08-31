import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessConfiguration, constantTimeTextEqual, verifyAccessToken } from "./lib/security/accessSession";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = Number.parseInt(process.env.RATE_LIMIT_PER_MIN || "60", 10);
const ROUTE_LIMITS = {
  "/api/auth/access": 10,
  "/api/damage-agent": 20,
  "/api/verify-agent": 20,
  "/api/imagery-agent": 20,
  "/api/zip-scan": 10,
  "/api/crm-sync": 10,
};
const PUBLIC_EXACT = new Set(["/access", "/api/auth/access", "/api/auth/session", "/api/auth/logout", "/api/auth/gateway-check", "/api/oversight/pulse/permits"]);
const hits = new Map();

function allowRate(key, limit) {
  const now = Date.now();
  const active = (hits.get(key) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  if (active.length >= limit) {
    hits.set(key, active);
    return false;
  }
  active.push(now);
  hits.set(key, active);
  if (hits.size > 5000) hits.clear();
  return true;
}

function isPublicPath(pathname) {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith("/portal/") || pathname === "/api/portal-chat";
}

function requestIp(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

function apiKeyAuthorized(request) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) return false;
  const suppliedHeader = request.headers.get("x-api-key");
  const authorization = request.headers.get("authorization") || "";
  const suppliedBearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return constantTimeTextEqual(suppliedHeader, expected) || constantTimeTextEqual(suppliedBearer, expected);
}

function cronAuthorized(request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return constantTimeTextEqual(request.headers.get("authorization"), `Bearer ${expected}`);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const ip = requestIp(request);
  const limit = ROUTE_LIMITS[pathname] || DEFAULT_LIMIT;

  if (!allowRate(`${ip}:${pathname}`, limit)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  if (isPublicPath(pathname)) return NextResponse.next();

  const configuration = accessConfiguration();
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  const ownerAuthorized = configuration.configured && await verifyAccessToken(token, configuration.sessionSecret);
  const authorized = configuration.developmentBypass || ownerAuthorized || apiKeyAuthorized(request) || cronAuthorized(request);

  if (authorized) {
    const response = NextResponse.next();
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("referrer-policy", "same-origin");
    response.headers.set("x-frame-options", "DENY");
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: configuration.configured ? "Unauthorized" : "Owner access protection is not configured." },
      { status: configuration.configured ? 401 : 503 }
    );
  }

  const destination = request.nextUrl.clone();
  destination.pathname = "/access";
  destination.search = "";
  destination.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
