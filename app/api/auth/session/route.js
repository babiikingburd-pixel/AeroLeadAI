import { NextResponse } from "next/server";
import { ACCESS_COOKIE, accessConfiguration, verifyAccessToken } from "../../../../lib/security/accessSession";
import { resolveSupabaseServerConfig, supabaseEnvironmentDiagnostics } from "../../../../lib/supabaseEnvironment";
import { authenticatedSupabaseFetch } from "../../../../lib/supabaseServiceProxy";

export const dynamic = "force-dynamic";

async function probeDatabaseIdentity() {
  const { url, key, configured } = resolveSupabaseServerConfig();
  if (!configured) return { ok: false, status: 503, category: "service-key-not-configured" };
  try {
    const response = await authenticatedSupabaseFetch(`${url}/rest/v1/top500_slots?select=slot_no&limit=1`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return {
      ok: response.ok,
      status: response.status,
      category: response.ok ? "clean-project-connected" : response.status === 401 ? "key-rejected" : "database-query-rejected",
    };
  } catch {
    return { ok: false, status: 503, category: "database-unreachable" };
  }
}

export async function GET(request) {
  const configuration = accessConfiguration();
  const authenticated = configuration.developmentBypass || (configuration.configured && await verifyAccessToken(request.cookies.get(ACCESS_COOKIE)?.value, configuration.sessionSecret));
  const diagnosticsRequested = request.nextUrl.searchParams.get("database") === "identity";
  const database = diagnosticsRequested
    ? { ...supabaseEnvironmentDiagnostics(), connection: await probeDatabaseIdentity() }
    : undefined;
  return NextResponse.json(
    {
      ok: true,
      authenticated,
      ...(diagnosticsRequested ? { database } : {}),
    },
    { status: authenticated ? 200 : 401 }
  );
}
