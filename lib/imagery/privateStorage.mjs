import crypto from "node:crypto";

export const PROPERTY_IMAGE_BUCKET = "property-images";

const safeSegment = (value) => String(value || "unknown").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);

export function decodeImageDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) return null;
  return {
    buffer,
    contentType: match[1].toLowerCase(),
    contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function extensionFor(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "jpg";
}

export async function signImageRows(supabase, rows = [], expiresIn = 900) {
  const paths = [...new Set(rows.map((row) => row.storage_path).filter(Boolean))];
  if (!paths.length) return rows.map((row) => ({ ...row, signed_url: null }));
  const { data, error } = await supabase.storage.from(PROPERTY_IMAGE_BUCKET).createSignedUrls(paths, expiresIn);
  if (error) throw error;
  const signedByPath = new Map((data || []).map((item) => [item.path, item.signedUrl || item.signedURL || null]));
  return rows.map((row) => ({ ...row, signed_url: row.storage_path ? signedByPath.get(row.storage_path) || null : null }));
}

export async function signedPathsToDataUrls(supabase, storagePaths = {}) {
  const entries = Object.entries(storagePaths || {}).filter(([, path]) => Boolean(path));
  if (!entries.length) return {};
  const { data, error } = await supabase.storage.from(PROPERTY_IMAGE_BUCKET).createSignedUrls(entries.map(([, path]) => path), 120);
  if (error) throw error;
  const signedByPath = new Map((data || []).map((item) => [item.path, item.signedUrl || item.signedURL || null]));
  const hydrated = {};
  await Promise.all(entries.map(async ([angle, path]) => {
    const url = signedByPath.get(path);
    if (!url) return;
    const response = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!response.ok) return;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1000) return;
    hydrated[angle] = `data:${contentType};base64,${buffer.toString("base64")}`;
  }));
  return hydrated;
}

export async function persistImageryAngles(supabase, { cacheKey, propertyId, provider, angles, capturedAt }) {
  const stamp = new Date(capturedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
  const root = `imagery/${safeSegment(propertyId || cacheKey)}/${stamp}`;
  const storagePaths = {};
  const contentHashes = {};
  const byteSizes = {};
  const mimeTypes = {};

  for (const [angle, dataUrl] of Object.entries(angles || {})) {
    const decoded = decodeImageDataUrl(dataUrl);
    if (!decoded) continue;
    const path = `${root}/${safeSegment(angle)}.${extensionFor(decoded.contentType)}`;
    const { error } = await supabase.storage.from(PROPERTY_IMAGE_BUCKET).upload(path, decoded.buffer, {
      contentType: decoded.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error && !/already exists|duplicate/i.test(error.message || "")) throw error;
    storagePaths[angle] = path;
    contentHashes[angle] = decoded.contentHash;
    byteSizes[angle] = decoded.buffer.length;
    mimeTypes[angle] = decoded.contentType;
  }

  return { storagePaths, contentHashes, byteSizes, mimeTypes };
}

export async function removeStoragePaths(supabase, manifests = []) {
  const paths = [...new Set(manifests.flatMap((manifest) => Object.values(manifest?.storage_paths || {})).filter(Boolean))];
  if (!paths.length) return 0;
  const { error } = await supabase.storage.from(PROPERTY_IMAGE_BUCKET).remove(paths);
  if (error) throw error;
  return paths.length;
}
