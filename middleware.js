// Global API guard: per-IP rate limiting + structured request logging for
// EVERY /api/* route in one place. In-memory sliding window — per serverless
// instance, which is the right cheap default on Vercel (each instance
// independently caps abuse; expensive-API abuse from one IP gets throttled
// without any external store). Swap the Map for Upstash/Redis if you need a
// global counter later.
import { NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "60", 10);
// Expensive AI/imagery routes get a tighter cap than cheap lookups.
const ROUTE_LIMITS = {
  "/api/damage-agent": 20,
  "/api/verify-agent": 20,
  "/api/imagery-agent": 20,
  "/api/zip-scan": 10,
  "/api/crm-sync": 10,
};

const hits = new Map(); // key -> [timestamps]

function allow(key, limit) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear(); // memory safety valve
  return true;
}

export function middleware(req) {
  const { pathname } = req.nextUrl;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = ROUTE_LIMITS[pathname] || DEFAULT_LIMIT;

  // Request log (visible in Vercel function logs)
  console.log(JSON.stringify({ t: new Date().toISOString(), ip, method: req.method, path: pathname }));

  if (!allow(`${ip}:${pathname}`, limit)) {
    console.warn(JSON.stringify({ t: new Date().toISOString(), ip, path: pathname, event: "RATE_LIMITED" }));
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
