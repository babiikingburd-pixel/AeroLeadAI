export function isPaidRequest(value) {
  return value === true || value === 1 || value === "1";
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

export function publicImageryPayload(payload) {
  const cleaned = stripKeyedUrls(payload) || {};
  const angles = {};
  for (const [key, url] of Object.entries(cleaned.angles || {})) {
    if (typeof url === "string" && url.startsWith("data:image/")) angles[key] = url;
  }
  return { ...cleaned, angles };
}
