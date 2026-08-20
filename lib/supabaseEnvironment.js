// AeroLeadAI's production data plane is intentionally pinned to the clean,
// bounded Top 500 project. Vercel can retain old variables after a project
// migration, so selecting the first non-empty key is unsafe: a valid key from
// the retired project produces Supabase's misleading "Invalid API key" error
// when paired with the new URL.

export const AEROLEAD_SUPABASE_PROJECT_REF = "jxpjxvfhedyroonnwjqm";
export const AEROLEAD_SUPABASE_URL = `https://${AEROLEAD_SUPABASE_PROJECT_REF}.supabase.co`;

const SERVER_KEY_NAMES = [
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_KEY",
];

function projectRefFromUrl(value) {
  try {
    const hostname = new URL(String(value || "")).hostname;
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function jwtClaims(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function describeKey(name, value) {
  if (!value) return null;
  const claims = jwtClaims(value);
  const format = value.startsWith("sb_secret_")
    ? "secret"
    : value.startsWith("sb_publishable_")
      ? "publishable"
      : claims
        ? "legacy-jwt"
        : "unknown";
  return {
    name,
    value,
    format,
    ref: typeof claims?.ref === "string" ? claims.ref : null,
    role: typeof claims?.role === "string" ? claims.role : null,
  };
}

function serverKeyCandidates() {
  return SERVER_KEY_NAMES
    .map((name) => describeKey(name, process.env[name]))
    .filter(Boolean);
}

export function resolveSupabaseServerConfig() {
  const candidates = serverKeyCandidates();
  const matchingLegacyServiceKey = candidates.find((candidate) =>
    candidate.format === "legacy-jwt" &&
    candidate.ref === AEROLEAD_SUPABASE_PROJECT_REF &&
    candidate.role === "service_role"
  );
  const modernSecretKey = candidates.find((candidate) => candidate.format === "secret");
  const gatewaySigningSecretConfigured = String(process.env.AEROLEAD_SESSION_SECRET || process.env.INTERNAL_API_KEY || "").length >= 24;
  const selected = matchingLegacyServiceKey || (!gatewaySigningSecretConfigured ? modernSecretKey : null) || null;
  const mode = matchingLegacyServiceKey
    ? "direct-service-role"
    : gatewaySigningSecretConfigured
      ? "edge-service-role-proxy"
      : modernSecretKey
        ? "direct-modern-secret"
        : "unconfigured";

  return {
    url: AEROLEAD_SUPABASE_URL,
    key: selected?.value || null,
    configured: Boolean(selected?.value || gatewaySigningSecretConfigured),
    mode,
    selectedName: selected?.name || null,
    selection: matchingLegacyServiceKey
      ? "matching-service-role"
      : gatewaySigningSecretConfigured
        ? "signed-edge-service-role-proxy"
        : modernSecretKey
        ? "modern-secret-unverifiable-ref"
        : "no-clean-project-service-key",
  };
}

// This intentionally contains identity metadata only—never key material.
// It is safe to include in operational health output when diagnosing a Vercel
// project migration.
export function supabaseEnvironmentDiagnostics() {
  const candidates = serverKeyCandidates();
  const selected = resolveSupabaseServerConfig();
  return {
    targetRef: AEROLEAD_SUPABASE_PROJECT_REF,
    configuredUrlRefs: {
      SUPABASE_URL: projectRefFromUrl(process.env.SUPABASE_URL),
      NEXT_PUBLIC_SUPABASE_URL: projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    },
    candidates: candidates.map(({ name, format, ref, role }) => ({ name, format, ref, role })),
    selectedName: selected.selectedName,
    selection: selected.selection,
    mode: selected.mode,
    configured: selected.configured,
  };
}
