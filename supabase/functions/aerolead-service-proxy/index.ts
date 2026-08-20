declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const VERIFY_URL = "https://aero-lead-ai.vercel.app/api/auth/gateway-check";
const TOKEN_TTL_MS = 5 * 60_000;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"]);
const ALLOWED_PATHS = ["/rest/v1/", "/storage/v1/"];
const FORWARDED_REQUEST_HEADERS = new Set([
  "accept",
  "accept-profile",
  "content-profile",
  "content-type",
  "if-match",
  "if-none-match",
  "prefer",
  "range",
  "range-unit",
  "x-client-info",
  "x-upsert",
]);
const FORWARDED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-disposition",
  "content-length",
  "content-location",
  "content-range",
  "content-type",
  "etag",
  "location",
  "preference-applied",
  "range-unit",
  "x-supabase-api-version",
]);

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) mismatch |= (left[index] || 0) ^ (right[index] || 0);
  return mismatch === 0;
}

async function issueProxyToken(serviceKey: string): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = base64Url(encoder.encode(JSON.stringify({ version: 1, expiresAt })));
  const signature = base64Url(await hmac(serviceKey, payload));
  return { token: `${payload}.${signature}`, expiresAt };
}

async function verifyProxyToken(serviceKey: string, token: string): Promise<boolean> {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (parsed.version !== 1 || Number(parsed.expiresAt) <= Date.now()) return false;
    return equalBytes(await hmac(serviceKey, payload), decodeBase64Url(signature));
  } catch {
    return false;
  }
}

async function verifyWithAeroLeadAI(request: Request): Promise<boolean> {
  const headers = new Headers();
  for (const name of [
    "x-aerolead-gateway-timestamp",
    "x-aerolead-gateway-method",
    "x-aerolead-gateway-target",
    "x-aerolead-gateway-signature",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function json(message: string, status: number): Response {
  return new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

Deno.serve(async (request: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) return json("Service-role environment unavailable", 503);

  const requestUrl = new URL(request.url);
  const target = requestUrl.searchParams.get("target") || "";
  const method = request.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return json("Method rejected", 405);
  if (target.startsWith("//") || !ALLOWED_PATHS.some((prefix) => target.startsWith(prefix))) {
    return json("Target rejected", 400);
  }
  if (request.headers.get("x-aerolead-gateway-method") !== method || request.headers.get("x-aerolead-gateway-target") !== target) {
    return json("Signed request identity mismatch", 401);
  }

  let proxyToken = request.headers.get("x-aerolead-proxy-token") || "";
  let proxyTokenExpiresAt = 0;
  if (!await verifyProxyToken(serviceKey, proxyToken)) {
    if (!await verifyWithAeroLeadAI(request)) return json("AeroLeadAI gateway authorization failed", 401);
    const issued = await issueProxyToken(serviceKey);
    proxyToken = issued.token;
    proxyTokenExpiresAt = issued.expiresAt;
  }

  const upstreamHeaders = new Headers();
  request.headers.forEach((value, name) => {
    if (FORWARDED_REQUEST_HEADERS.has(name.toLowerCase())) upstreamHeaders.set(name, value);
  });
  upstreamHeaders.set("apikey", serviceKey);
  upstreamHeaders.set("authorization", `Bearer ${serviceKey}`);

  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const upstream = await fetch(`${supabaseUrl}${target}`, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, name) => {
    if (FORWARDED_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value);
  });
  responseHeaders.set("cache-control", "no-store");
  if (proxyTokenExpiresAt) {
    responseHeaders.set("x-aerolead-proxy-token", proxyToken);
    responseHeaders.set("x-aerolead-proxy-token-expires", String(proxyTokenExpiresAt));
  }

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
});
