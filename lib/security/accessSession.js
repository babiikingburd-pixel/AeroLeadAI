export const ACCESS_COOKIE = "aerolead_owner_session";
export const ACCESS_TTL_SECONDS = 60 * 60 * 12;

const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(secret, payload) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export function accessConfiguration() {
  const accessCode = process.env.AEROLEAD_ACCESS_CODE || process.env.INTERNAL_API_KEY || "";
  const sessionSecret = process.env.AEROLEAD_SESSION_SECRET || process.env.INTERNAL_API_KEY || "";
  const developmentBypass = process.env.NODE_ENV !== "production" && process.env.AEROLEAD_ALLOW_UNAUTHENTICATED_DEV === "true";
  return {
    accessCode,
    sessionSecret,
    developmentBypass,
    configured: accessCode.length >= 12 && sessionSecret.length >= 24,
  };
}

export function constantTimeTextEqual(left, right) {
  const a = encoder.encode(String(left || ""));
  const b = encoder.encode(String(right || ""));
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) mismatch |= (a[index] || 0) ^ (b[index] || 0);
  return mismatch === 0;
}

export async function createAccessToken(secret, ttlSeconds = ACCESS_TTL_SECONDS) {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    version: 1,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: bytesToBase64Url(nonce),
  })));
  const signed = await signature(secret, payload);
  return `${payload}.${bytesToBase64Url(signed)}`;
}

export async function verifyAccessToken(token, secret) {
  if (!token || !secret) return false;
  const [payload, suppliedSignature, extra] = String(token).split(".");
  if (!payload || !suppliedSignature || extra) return false;
  let expected;
  let supplied;
  try {
    expected = await signature(secret, payload);
    supplied = base64UrlToBytes(suppliedSignature);
  } catch {
    return false;
  }
  let mismatch = expected.length ^ supplied.length;
  const length = Math.max(expected.length, supplied.length);
  for (let index = 0; index < length; index++) mismatch |= (expected[index] || 0) ^ (supplied[index] || 0);
  if (mismatch !== 0) return false;
  try {
    const decoded = new TextDecoder().decode(base64UrlToBytes(payload));
    const parsed = JSON.parse(decoded);
    return parsed.version === 1 && Number(parsed.expiresAt) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function accessCookieOptions(maxAge = ACCESS_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge,
  };
}
