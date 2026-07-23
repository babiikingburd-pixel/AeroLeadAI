import { supabaseServer } from "../supabaseServer";

// Verifies the shared-secret header (set as a custom header on the
// pathway's webhook config in Bland's dashboard — see pathway.json's
// "webhook" note) and applies the call outcome onto the matching lead.
// If BLAND_WEBHOOK_SECRET isn't set, verification is skipped (matches this
// codebase's convention of degrading gracefully rather than hard-failing
// on missing optional config) — set it before going live.
export function verifySignature(headerValue) {
  const expected = process.env.BLAND_WEBHOOK_SECRET;
  if (!expected) return true;
  return headerValue === expected;
}

export async function applyCallOutcome(payload) {
  const supabase = supabaseServer();
  if (!supabase) return { ok: false, reason: "Supabase not configured." };

  const leadId = payload?.metadata?.lead_id;
  if (!leadId) return { ok: false, reason: "No lead_id in webhook metadata." };

  const vars = payload?.variables || payload?.extracted_variables || {};
  const consent = vars.consent === true || vars.consent === "true";
  const requestedTime = vars.requested_time || null;

  const { data: lead, error: fetchError } = await supabase.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (fetchError || !lead) return { ok: false, reason: "Lead not found." };

  const patch = { consent, requested_time: requestedTime, updated_at: new Date().toISOString() };
  // Consent + a requested time is the trigger to move straight to BOOK —
  // the pipeline's own 'contact' handler only ever places the call and
  // waits, it has no way to know the call finished; this webhook is that
  // signal.
  if (consent && requestedTime && lead.stage === "contact") {
    patch.stage = "book";
    patch.stage_history = [...(lead.stage_history || []), { stage: "book", at: new Date().toISOString(), from: "contact" }];
  }

  const { error: updateError } = await supabase.from("leads").update(patch).eq("id", leadId);
  if (updateError) return { ok: false, reason: updateError.message };
  return { ok: true, leadId, advanced: !!patch.stage };
}
