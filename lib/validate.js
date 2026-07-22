// Input validation helpers shared by API routes. Keep them boring and strict.
export function isValidLatLon(lat, lon) {
  const la = parseFloat(lat), lo = parseFloat(lon);
  return Number.isFinite(la) && Number.isFinite(lo) && la >= -90 && la <= 90 && lo >= -180 && lo <= 180;
}

export function isValidAddress(a) {
  return typeof a === "string" && a.trim().length >= 3 && a.length <= 300;
}

export function isValidZip(z) {
  return typeof z === "string" && /^\d{5}$/.test(z.trim());
}

// Base64 image payload sanity: bounded size (default 8 MB decoded) and
// image-ish media type. Prevents oversized bodies from reaching paid vision APIs.
export function isValidImagePayload(base64, mediaType, maxBytes = 8 * 1024 * 1024) {
  if (typeof base64 !== "string" || base64.length === 0) return false;
  if (base64.length * 0.75 > maxBytes) return false;
  if (mediaType && !/^image\//.test(mediaType)) return false;
  return true;
}
