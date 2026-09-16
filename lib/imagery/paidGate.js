export const PAID_PROVIDERS = ["nearmap", "google", "mapbox"];
export const FREE_PROVIDERS = ["esri-free", "esri_world_imagery", "esri", "stored"];

export function isPaidRequest(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function normalizeProvider(provider) {
  return String(provider || "").trim().toLowerCase();
}

export function isPaidProvider(provider) {
  const id = normalizeProvider(provider).replace(/^aerolead_imagery:/, "");
  return PAID_PROVIDERS.includes(id) || id.startsWith("nearmap") || id.startsWith("google") || id.startsWith("mapbox");
}

export function isFreeProvider(provider) {
  const id = normalizeProvider(provider).replace(/^aerolead_imagery:/, "");
  return FREE_PROVIDERS.includes(id) || id.startsWith("esri") || id === "stored";
}

export function providerPlan({ paid, keys = {} } = {}) {
  if (!paid) {
    return [{ id: "esri-free", paid: false }];
  }
  const plan = [];
  if (keys.nearmap) plan.push({ id: "nearmap", paid: true });
  if (keys.google) plan.push({ id: "google", paid: true });
  if (keys.mapbox) plan.push({ id: "mapbox", paid: true });
  plan.push({ id: "esri-free", paid: false });
  return plan;
}

export function cacheUsableForRequest(cached, { paid, lite } = {}) {
  if (!cached) return false;
  const provider = cached.provider;
  if (!paid) return !isPaidProvider(provider);
  if (!lite) {
    const angles = cached.angles || cached.storage_paths || {};
    const hasStreet = Object.keys(angles).some((key) => String(key).startsWith("vantage"));
    if (!hasStreet && !isPaidProvider(provider)) return false;
  }
  return true;
}

export function stripKeyedUrls(value) {
  if (typeof value === "string") {
    if (/[?&](key|access_token|apikey|api_key)=/i.test(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(stripKeyedUrls).filter((item) => item != null);
  if (value && typeof value === "object") {
    const next = {};
    for (const [k, v] of Object.entries(value)) {
      const cleaned = stripKeyedUrls(v);
      if (cleaned != null) next[k] = cleaned;
    }
    return next;
  }
  return value;
}

export function publicImageryPayload(payload, extra = {}) {
  const cleaned = stripKeyedUrls(payload) || {};
  const angles = {};
  for (const [key, url] of Object.entries(cleaned.angles || {})) {
    if (typeof url === "string" && url.startsWith("data:image/")) angles[key] = url;
  }
  return {
    ...cleaned,
    ...extra,
    angles,
    paid: Boolean(extra.paid ?? cleaned.paid),
  };
}
