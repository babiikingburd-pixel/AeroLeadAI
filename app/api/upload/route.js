import { isSupabaseConfigured, supabaseAdmin } from "../../../lib/supabase";

export const maxDuration = 30;

export async function POST(req) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const propertyId = form.get("propertyId") || "unknown";

    if (!file || typeof file === "string") {
      return Response.json({ success: false, error: "No file provided." }, { status: 400 });
    }

    if (!isSupabaseConfigured || !supabaseAdmin) {
      return Response.json({
        success: false,
        url: null,
        propertyId,
        error: "Supabase not configured — image was not persisted. Set NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY to enable uploads.",
      });
    }

    const ext = (file.name || "upload.jpg").split(".").pop();
    const path = `${propertyId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error } = await supabaseAdmin.storage
      .from("property-images")
      .upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: true });

    if (error) {
      return Response.json({ success: false, propertyId, error: error.message }, { status: 500 });
    }

    const { data } = supabaseAdmin.storage.from("property-images").getPublicUrl(path);

    return Response.json({ success: true, url: data?.publicUrl ?? null, propertyId });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}
