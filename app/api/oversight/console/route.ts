import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { loadOversightConsoleData } from "@/lib/oversight/consoleData";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const db = supabaseServer();
  if (!db) {
    return NextResponse.json(
      { error: "not_configured", degraded: true, warnings: ["Supabase server connection is not configured"] },
      { status: 503 },
    );
  }

  try {
    const result = await loadOversightConsoleData(db);
    const evidence = result.evidence.map((row: any) => row.payload?.image_url
      ? { ...row, payload: { ...row.payload, image_url: new URL(row.payload.image_url, request.url).toString() } }
      : row);

    // Partial database/provider failures must not blank the entire console.
    // Successful data is returned with degraded/warnings metadata so the UI
    // remains usable and operators can see exactly what needs attention.
    return NextResponse.json({ ...result, evidence }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "oversight_console_failed";
    return NextResponse.json(
      { error: message.slice(0, 300), degraded: true, warnings: [message.slice(0, 300)] },
      { status: 500 },
    );
  }
}
