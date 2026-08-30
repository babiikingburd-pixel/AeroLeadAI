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
  return <OversightConsole initial={{ profiles: profiles.data || [], evidence: evidence.data || [], rings: rings.data || [], connectionError: error?.message || null }} />;
}
