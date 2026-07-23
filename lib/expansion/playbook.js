import { supabaseServer } from "../supabaseServer";

/**
 * #18 National Expansion Playbook
 *
 * A repeatable checklist + tracker for launching a new region — not
 * AI-driven, intentionally, because region launches are compliance/ops-
 * heavy and benefit from a fixed process more than a model's judgment.
 */

export const REGION_LAUNCH_CHECKLIST = [
  { step: "compliance_review", label: "Confirm state contractor licensing + roofing regulations", category: "compliance" },
  { step: "territory_mapping", label: "Define exclusive territory boundaries (GeoJSON polygons)", category: "ops" },
  { step: "contractor_recruitment", label: "Recruit minimum viable contractor bench (recommend 3+ per damage type)", category: "growth" },
  { step: "insurance_verification", label: "Verify all onboarded contractors carry required insurance minimums for this state", category: "compliance" },
  { step: "imagery_coverage", label: "Confirm satellite imagery provider has adequate resolution/coverage for this region", category: "product" },
  { step: "local_marketing", label: "Launch initial campaign(s) targeted at region zip codes", category: "marketing" },
  { step: "support_readiness", label: "Confirm support coverage (hours, escalation contact) for the new region", category: "ops" },
  { step: "pricing_calibration", label: "Set/verify cost-per-sqft baseline against local labor/material costs", category: "finance" },
  { step: "launch_review", label: "Go/no-go review with all above steps checked", category: "ops" },
];

export async function startRegionLaunch({ regionName, states, targetZipCodes }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase
    .from("region_launches")
    .insert({
      region_name: regionName, states, target_zip_codes: targetZipCodes,
      checklist: REGION_LAUNCH_CHECKLIST.map((c) => ({ ...c, done: false, completed_at: null })),
      status: "in_progress",
    })
    .select().single();
  if (error) throw new Error(`Region launch creation failed: ${error.message}`);
  return data;
}

export async function listRegionLaunches() {
  const supabase = supabaseServer();
  if (!supabase) return [];
  const { data } = await supabase.from("region_launches").select("*").order("created_at", { ascending: false });
  return data || [];
}

export async function completeChecklistStep(regionLaunchId, step, notes) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: launch } = await supabase.from("region_launches").select("*").eq("id", regionLaunchId).single();
  if (!launch) throw new Error("Region launch not found");

  const checklist = launch.checklist.map((c) => (c.step === step ? { ...c, done: true, completed_at: new Date().toISOString(), notes } : c));
  const allDone = checklist.every((c) => c.done);

  await supabase.from("region_launches").update({ checklist, status: allDone ? "ready_to_launch" : "in_progress" }).eq("id", regionLaunchId);
  return { checklist, ready: allDone };
}

export async function getRegionLaunchStatus(regionLaunchId) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase.from("region_launches").select("*").eq("id", regionLaunchId).single();
  if (error) throw new Error("Region launch not found");
  const completed = data.checklist.filter((c) => c.done).length;
  return { ...data, progress: `${completed}/${data.checklist.length}` };
}
