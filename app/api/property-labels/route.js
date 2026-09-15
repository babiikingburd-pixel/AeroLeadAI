import { NextResponse } from "next/server";
import { DAMAGE_CLASSES, VERDICTS } from "../../../lib/labels";
import { supabaseServer } from "../../../lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SAFE_PROPERTY_ID = /^[A-Za-z0-9._-]{1,160}$/;
const SAFE_SHOT_KEY = /^[A-Za-z0-9._-]{1,120}$/;
const CLASS_IDS = new Set(DAMAGE_CLASSES.map((item) => item.id));
const VERDICT_IDS = new Set(VERDICTS.map((item) => item.id));

function errorResponse(error, status) {
  return NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
}

function identifiers(input) {
  const propertyId = String(input?.propertyId || "").trim();
  const shotKey = String(input?.shotKey || "").trim();
  if (!SAFE_PROPERTY_ID.test(propertyId)) return { error: "A valid propertyId is required." };
  if (!SAFE_SHOT_KEY.test(shotKey)) return { error: "A valid shotKey is required." };
  return { propertyId, shotKey };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeDocument(body) {
  const ids = identifiers(body);
  if (ids.error) return ids;

  const rawBoxes = Array.isArray(body.boxes) ? body.boxes.slice(0, 200) : [];
  const boxes = [];
  for (const raw of rawBoxes) {
    const x = finiteNumber(raw?.x);
    const y = finiteNumber(raw?.y);
    const w = finiteNumber(raw?.w);
    const h = finiteNumber(raw?.h);
    if (!CLASS_IDS.has(raw?.classId) || x == null || y == null || w == null || h == null) {
      return { error: "Every box must have a supported class and finite coordinates." };
    }
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || w > 20000 || h > 20000) {
      return { error: "Box coordinates are outside the supported image bounds." };
    }
    boxes.push({
      id: SAFE_SHOT_KEY.test(String(raw.id || "")) ? String(raw.id) : crypto.randomUUID(),
      classId: raw.classId,
      x,
      y,
      w,
      h,
    });
  }

  const verdict = body.verdict == null || body.verdict === ""
    ? null
    : VERDICT_IDS.has(body.verdict)
      ? body.verdict
      : undefined;
  if (verdict === undefined) return { error: "Unsupported verdict." };

  return {
    propertyId: ids.propertyId,
    shotKey: ids.shotKey,
    doc: {
      version: 1,
      propertyId: ids.propertyId,
      address: String(body.address || "").slice(0, 300),
      lat: finiteNumber(body.lat),
      lon: finiteNumber(body.lon),
      shotKey: ids.shotKey,
      source: String(body.source || "unknown").slice(0, 120),
      gsdNote: String(body.gsdNote || "Web tile or street-static image; not hail-bruise grade.").slice(0, 500),
      boxes,
      verdict,
      notes: String(body.notes || "").slice(0, 5000),
      labeledAt: new Date().toISOString(),
    },
  };
}

export async function GET(request) {
  const url = new URL(request.url);
  const ids = identifiers({
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
  const normalized = normalizeDocument(body);
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

