import { NextResponse } from "next/server";
import { labelPath, readJson, writeJson } from "../../../../lib/inspect/store";

export async function GET(req) {
  const id = new URL(req.url).searchParams.get("propertyId");
  if (!id) {
    return NextResponse.json({ ok: false, error: "propertyId required" }, { status: 400 });
  }
  const doc = await readJson(labelPath(id), null);
  return NextResponse.json({ ok: true, doc });
}

export async function POST(req) {
  const body = await req.json();
  if (!body?.propertyId) {
    return NextResponse.json({ ok: false, error: "propertyId required" }, { status: 400 });
  }
  if (!Array.isArray(body.boxes)) {
    return NextResponse.json({ ok: false, error: "boxes array required" }, { status: 400 });
  }
  const doc = {
    version: 1,
    propertyId: String(body.propertyId),
    address: body.address || null,
    lat: body.lat ?? null,
    lon: body.lon ?? null,
    shotKey: body.shotKey || null,
    source: body.source || null,
    gsdNote: body.gsdNote || "web-tile or street-static",
    boxes: body.boxes.map((b) => ({
      id: String(b.id),
      classId: String(b.classId),
      x: Number(b.x),
      y: Number(b.y),
      w: Number(b.w),
      h: Number(b.h),
    })),
    verdict: body.verdict || null,
    notes: body.notes || "",
    labeledAt: new Date().toISOString(),
  };
  await writeJson(labelPath(doc.propertyId), doc);
  return NextResponse.json({ ok: true, doc });
}
