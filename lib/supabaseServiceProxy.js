import { createGatewaySignature } from "./security/accessSession";
import { AEROLEAD_SUPABASE_URL, resolveSupabaseServerConfig } from "./supabaseEnvironment";

// The legacy anon JWT is a publishable invocation credential, not a database
// secret. RLS remains deny-all. The Edge Function exchanges only a valid,
// short-lived AeroLeadAI server signature for service-role access.
export const AEROLEAD_EDGE_INVOKE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuZnhteG9xa3ptenNobWtmanNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwNjQ5NzQsImV4cCI6MjEwMzY0MDk3NH0.BCoz4dyMikf6YMR8wCy8p6PQaGjmlGlMYbHPB2x7nbk";

const PROXY_URL = `${AEROLEAD_SUPABASE_URL}/functions/v1/aerolead-service-proxy`;
let cachedProxyToken = "";
let cachedProxyTokenExpiresAt = 0;

function gatewaySecret() {
  return process.env.AEROLEAD_SESSION_SECRET || process.env.INTERNAL_API_KEY || "";
}

function requestParts(input, init) {
  const source = input instanceof Request ? input : null;
  const url = new URL(source?.url || String(input));
  const headers = new Headers(source?.headers || undefined);
  new Headers(init?.headers || undefined).forEach((value, name) => headers.set(name, value));
  return {
    source,
    url,
    headers,
    method: String(init?.method || source?.method || "GET").toUpperCase(),
    body: init?.body ?? source?.body,
  };
}

export async function supabaseServiceProxyFetch(input, init = {}) {
  const { url, headers, method, body } = requestParts(input, init);
  if (url.origin !== AEROLEAD_SUPABASE_URL) {
    return new Response(JSON.stringify({ message: "Supabase proxy target rejected" }), { status: 502, headers: { "content-type": "application/json" } });
  }

  const target = `${url.pathname}${url.search}`;
  const timestamp = String(Date.now());
  const signature = await createGatewaySignature(gatewaySecret(), timestamp, method, target);
  if (!signature) {
    return new Response(JSON.stringify({ message: "AeroLeadAI database gateway is not configured" }), { status: 503, headers: { "content-type": "application/json" } });
  }

  headers.delete("host");
  headers.set("apikey", AEROLEAD_EDGE_INVOKE_KEY);
  headers.set("authorization", `Bearer ${AEROLEAD_EDGE_INVOKE_KEY}`);
  headers.set("x-aerolead-gateway-timestamp", timestamp);
  headers.set("x-aerolead-gateway-method", method);
  headers.set("x-aerolead-gateway-target", target);
  headers.set("x-aerolead-gateway-signature", signature);
  if (cachedProxyToken && cachedProxyTokenExpiresAt > Date.now() + 5_000) {
    headers.set("x-aerolead-proxy-token", cachedProxyToken);
  }

  const proxyInit = {
    ...init,
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : body,
    cache: "no-store",
  };
  if (proxyInit.body && typeof proxyInit.body?.getReader === "function") proxyInit.duplex = "half";

  const response = await fetch(`${PROXY_URL}?target=${encodeURIComponent(target)}`, proxyInit);
  const issuedToken = response.headers.get("x-aerolead-proxy-token");
  const issuedExpiry = Number(response.headers.get("x-aerolead-proxy-token-expires") || 0);
  if (issuedToken && issuedExpiry > Date.now()) {
    cachedProxyToken = issuedToken;
    cachedProxyTokenExpiresAt = issuedExpiry;
  }
  return response;
}

export async function authenticatedSupabaseFetch(input, init = {}) {
  const configuration = resolveSupabaseServerConfig();
  if (!configuration.configured) {
    return new Response(JSON.stringify({ message: "Clean-project Supabase access is not configured" }), { status: 503, headers: { "content-type": "application/json" } });
  }
  if (configuration.mode === "edge-service-role-proxy") return supabaseServiceProxyFetch(input, init);

  const headers = new Headers(init.headers || undefined);
  headers.set("apikey", configuration.key);
  headers.set("authorization", `Bearer ${configuration.key}`);
  return fetch(input, { ...init, headers });
}
