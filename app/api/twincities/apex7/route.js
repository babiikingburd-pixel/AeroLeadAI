import { supabaseServer } from "../../../../lib/supabaseServer";
import { rankValidationBatch } from "../../../../lib/twincities/apex7Engine";
import { chooseWork } from "../../../../lib/twincities/apex7Queue";
import { OPEN_LEAD_VALIDATION_STATES } from "../../../../lib/twincities/validationState";

export const maxDuration = 300;

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });
  let body = {};
  try { body = await req.json(); } catch {}
  const limit = Math.min(Number(body.limit ?? 100), 500);
  const { data, error } = await supabase
    .from("batch_leads")
    .select("*")
    // The states the validation worker actually writes, plus the schema
    // default. The previous list ("pending"/"unknown"/"needs_validation") was
    // written by nothing in this codebase, so this endpoint returned an empty
    // work set for all 152K leads.
    .in("validation_status", OPEN_LEAD_VALIDATION_STATES)
    .order("priority_score", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const ranked = rankValidationBatch(data ?? []);
  const work = chooseWork(ranked, limit);
  return Response.json({ ok: true, version: "7.0.0", candidates: ranked.length, work: work.map((r) => ({ id: r.id, address: r.address, city: r.city, score: r.priority_score, validationPriority: r.apex7_queue_priority, checks: r.apex7_validation_checks, fingerprint: r.apex7_evidence_fingerprint })) });
}
