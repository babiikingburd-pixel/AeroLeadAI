import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

const BUCKET = "property-images";
const SAFE_PARCEL_ID = /^[A-Za-z0-9._-]{1,160}$/;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(_request: Request, { params }: { params: { parcelId: string } }) {
  const parcelId = params.parcelId;
  if (!SAFE_PARCEL_ID.test(parcelId)) return jsonError("invalid_parcel_id", 400);

  const db = supabaseServer();
  if (!db) return jsonError("not_configured", 503);

  const record = await db
    .from("evidence_records")
    .select("payload,captured_at")
    .eq("parcel_id", parcelId)
    .eq("type", "IMAGERY")
    .in("reality", ["REAL_NOW", "CACHED_REAL"])
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (record.error) return jsonError(record.error.message, 502);
  const storagePath = record.data?.payload?.storage_path;
  if (
    typeof storagePath !== "string" ||
    storagePath.startsWith("/") ||
    storagePath.split("/").includes("..")
  ) return jsonError("image_not_found", 404);

  const signed = await db.storage.from(BUCKET).createSignedUrl(storagePath, 900);
  if (!signed.error && signed.data?.signedUrl) {
    return NextResponse.redirect(signed.data.signedUrl, {
      status: 307,
      headers: { "Cache-Control": "private, max-age=300" },
    });
  }

  // If URL signing is unavailable, stream the private object through this
  // owner-protected route instead of leaving the lead without its photo.
  const downloaded = await db.storage.from(BUCKET).download(storagePath);
  if (downloaded.error || !downloaded.data) return jsonError(downloaded.error?.message || "image_unavailable", 502);

  return new Response(downloaded.data, {
    status: 200,
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Type": record.data?.payload?.mime_type || downloaded.data.type || "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
