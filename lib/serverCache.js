// Tiny in-memory TTL cache for API routes. Dedupes repeat geocoding /
// zip-scan / reverse-geocode calls within a warm serverless instance so the
// same address never hits Census/Nominatim/Overpass twice in a session.
const store = new Map();

export function cacheGet(key) {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { store.delete(key); return null; }
  return hit.value;
}

export function cacheSet(key, value, ttlMs = 15 * 60 * 1000) {
  if (store.size > 500) {
    // drop oldest half when full
    const keys = [...store.keys()].slice(0, 250);
    keys.forEach((k) => store.delete(k));
  }
  store.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}
