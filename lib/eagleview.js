// Server-only EagleView connector.
// Supports client-credentials OAuth, a pre-issued bearer token, or x-api-key.
// Never import this file from a client component.

let tokenCache = { token: null, expiresAt: 0 };

export function eagleViewConfig() {
  const environment = (process.env.EAGLEVIEW_ENVIRONMENT || "sandbox").toLowerCase();
  const baseUrl = (process.env.EAGLEVIEW_BASE_URL ||
    (environment === "production" ? "https://apis.eagleview.com" : "https://sandbox.apis.eagleview.com"))
    .replace(/\/$/, "");

  return {
    environment,
    baseUrl,
    tokenUrl: process.env.EAGLEVIEW_TOKEN_URL || "https://apicenter.eagleview.com/oauth2/v1/token",
    clientId: process.env.EAGLEVIEW_CLIENT_ID || "",
    clientSecret: process.env.EAGLEVIEW_CLIENT_SECRET || "",
    accessToken: process.env.EAGLEVIEW_ACCESS_TOKEN || process.env.EAGLEVIEW_TOKEN || "",
    apiKey: process.env.EAGLEVIEW_API_KEY || "",
  };
}

export function eagleViewConfigured() {
  const cfg = eagleViewConfig();
  return Boolean(
    cfg.accessToken ||
    cfg.apiKey ||
    (cfg.clientId && cfg.clientSecret)
  );
}

async function oauthToken(cfg) {
  if (cfg.accessToken) return cfg.accessToken;
  if (!cfg.clientId || !cfg.clientSecret) return null;

  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");

  let res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    cache: "no-store",
  });

  // Some OAuth installations expect client_id/client_secret in the form body.
  if (!res.ok) {
    const fallbackBody = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: fallbackBody,
      cache: "no-store",
    });
  }

  const text = await res.text();
  let payload = {};
  try { payload = JSON.parse(text); } catch {}
  if (!res.ok || !payload.access_token) {
    const detail = payload.error_description || payload.error || text || `HTTP ${res.status}`;
    throw new Error(`EagleView OAuth failed: ${detail}`);
  }

  const expiresIn = Number(payload.expires_in || 3600);
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return payload.access_token;
}

export async function eagleViewHeaders(extra = {}) {
  const cfg = eagleViewConfig();
  const token = await oauthToken(cfg);
  const headers = { Accept: "application/json", ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  return headers;
}

export async function eagleViewFetch(path, options = {}) {
  const cfg = eagleViewConfig();
  if (!eagleViewConfigured()) {
    throw new Error("EagleView is not configured in the server environment.");
  }

  const headers = await eagleViewHeaders(options.headers || {});
  return fetch(`${cfg.baseUrl}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
}

export async function requestPropertyData({ address, lat, lon, productIds } = {}) {
  const payload = {};
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
    payload.coordinates = { lat: Number(lat), lon: Number(lon) };
  } else if (address) {
    payload.address = { completeAddress: String(address).trim() };
  } else {
    throw new Error("Provide an address or lat/lon.");
  }

  if (Array.isArray(productIds) && productIds.length) payload.productIds = productIds;

  const res = await eagleViewFetch("/property/v2/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`EagleView property request failed (${res.status}): ${data?.errorDescription || data?.message || text}`);
  }
  return data;
}

export async function getPropertyResult(requestId) {
  const res = await eagleViewFetch(`/property/v2/result/${encodeURIComponent(requestId)}`);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok && res.status !== 202) {
    throw new Error(`EagleView result failed (${res.status}): ${data?.errorDescription || data?.message || text}`);
  }
  return { status: res.status, data };
}

export function findRequestId(payload) {
  return payload?.request?.id || payload?.request?.requestId || payload?.id || payload?.requestId || null;
}

export function extractPropertyImages(payload) {
  const images = [];

  function walk(value, path = []) {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value) && typeof value.image_token === "string") {
      images.push({
        token: value.image_token,
        metadata: value.metadata || {},
        sourcePath: path.join("."),
      });
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, [...path, String(i)]));
    } else {
      Object.entries(value).forEach(([k, v]) => walk(v, [...path, k]));
    }
  }

  walk(payload);
  const seen = new Set();
  return images.filter((img) => {
    if (seen.has(img.token)) return false;
    seen.add(img.token);
    return true;
  });
}

export async function fetchPropertyImage(imageToken) {
  const cfg = eagleViewConfig();
  const headers = await eagleViewHeaders({ Accept: "image/png,image/*" });
  const res = await fetch(`${cfg.baseUrl}/property/v2/image/${encodeURIComponent(imageToken)}`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EagleView image failed (${res.status}): ${text}`);
  }
  return res;
}
