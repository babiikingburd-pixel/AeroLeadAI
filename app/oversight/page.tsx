import { supabaseServer } from "@/lib/supabaseServer";
import OversightConsole from "@/components/oversight/OversightConsole";
import { auditProperty } from "@/lib/oversight/doctor";
import { loadOversightConsoleData } from "@/lib/oversight/consoleData";
import "./oversight.css";
import "./cockpit-mode.css";
import "./superb.css";
import "./holo-deck.css";
import "./damage-overlay.css";
export const dynamic = "force-dynamic";

export default async function OversightPage() {
  const db = supabaseServer();
  if (!db) return <OversightConsole initial={{ profiles: [], evidence: [], rings: [], photoCount: 0, connectionError: "Supabase is not configured" }} />;
  const initial = await loadOversightConsoleData(db);
  const evidenceByParcel = new Map<string, any[]>();
  for (const row of initial.evidence) evidenceByParcel.set(row.parcel_id, [...(evidenceByParcel.get(row.parcel_id) || []), row]);
  const audits = Object.fromEntries(initial.profiles.map((profile: any) => [profile.parcel_id, auditProperty(profile, evidenceByParcel.get(profile.parcel_id) || [])]));
  return <OversightConsole initial={{ ...initial, audits }} />;
}
