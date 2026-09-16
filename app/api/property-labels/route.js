import { NextResponse } from "next/server";
import { labelIdentifiers, normalizeLabelDocument } from "../../../lib/labels";
import { supabaseServer } from "../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function errorResponse(error, status) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request) {
  const url = new URL(request.url);
  const ids = labelIdentifiers({
    propertyId: url.searchParams.get("propertyId"),
    shotKey: url.searchParams.get("shotKey"),
  });
  if (ids.error) return errorResponse(ids.error, 400);

  const db = supabaseServer();
  if (!db) return errorResponse("Supabase is not configured.", 503);
  const result = await db
    .from("oversight_property_labels")
    .select("document")
    .eq("property_id", ids.propertyId)
    .eq("shot_key", ids.shotKey)
    .maybeSingle();

  if (result.error) return errorResponse(result.error.message, 502);
  return NextResponse.json(
    { ok: true, doc: result.data?.document || null },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse("A JSON label document is required.", 400);
  const normalized = normalizeLabelDocument(body);
  if (normalized.error) return errorResponse(normalized.error, 400);

  const db = supabaseServer();
  if (!db) return errorResponse("Supabase is not configured.", 503);
  const result = await db
    .from("oversight_property_labels")
    .upsert(
      {
        property_id: normalized.propertyId,
        shot_key: normalized.shotKey,
        source: normalized.doc.source,
        document: normalized.doc,
        updated_at: normalized.doc.labeledAt,
      },
      { onConflict: "property_id,shot_key" }
    )
    .select("document")
    .single();

  if (result.error) return errorResponse(result.error.message, 502);
  return NextResponse.json({ ok: true, doc: result.data.document });
}
