import { supabaseServer } from "@/lib/supabaseServer";
import OversightConsole from "@/components/oversight/OversightConsole";
import "./oversight.css";
export const dynamic = "force-dynamic";

export default async function OversightPage() {
  const db = supabaseServer();
  if (!db) return <OversightConsole initial={{ profiles: [], evidence: [], rings: [], connectionError: "Supabase is not configured" }} />;
  const [profiles, evidence, rings] = await Promise.all([
    db.from("roof_profiles").select("*").order("commercial_priority", { ascending: false }).limit(500),
    db.from("evidence_records").select("*").order("captured_at", { ascending: false }).limit(2500),
    db.from("ring_status").select("*").order("ring_id"),
  ]);
  const error = profiles.error || evidence.error || rings.error;
  let hydratedEvidence = evidence.data || [];
  const imagePaths = [...new Set(hydratedEvidence
    .filter((row: any) => row.type === "IMAGERY")
    .map((row: any) => row.payload?.storage_path)
    .filter(Boolean))];
  if (imagePaths.length) {
    const { data: signed, error: signError } = await db.storage.from("property-images").createSignedUrls(imagePaths, 3600);
    if (!signError) {
      const signedByPath = new Map((signed || []).map((item: any) => [item.path, item.signedUrl || item.signedURL || null]));
      hydratedEvidence = hydratedEvidence.map((row: any) => row.type === "IMAGERY" && row.payload?.storage_path
        ? { ...row, payload: { ...row.payload, image_url: signedByPath.get(row.payload.storage_path) || null } }
        : row);
    }
  }
  return <OversightConsole initial={{ profiles: profiles.data || [], evidence: hydratedEvidence, rings: rings.data || [], connectionError: error?.message || null }} />;
}
