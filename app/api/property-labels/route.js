import { NextResponse } from "next/server";
import { labelPath, readJson, writeJson } from "../../../lib/inspect/store";

export async function GET(req) {
  const id = new URL(req.url).searchParams.get("propertyId");
  if (!id) {
    return NextResponse.json({ ok: false, error: "propertyId required" }, { status: 400 });
  }
  const doc = await readJson(labelPath(id), null);
  return NextResponse.json({ ok: true, doc, warning: "PR 39 disk labels are not production. Use PR 38 oversight_property_labels." });
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
    shotKey: body.shotKey || null,
    boxes: body.boxes,
    verdict: body.verdict || null,
    notes: body.notes || "",
    labeledAt: new Date().toISOString(),
  };
  await writeJson(labelPath(doc.propertyId), doc);
  return NextResponse.json({ ok: true, doc, warning: "PR 39 disk labels are not production. Use PR 38." });
}
