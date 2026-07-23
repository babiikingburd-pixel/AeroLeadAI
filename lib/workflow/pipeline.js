import { supabaseServer } from "../supabaseServer";
import { handlers } from "./stages";

export const STAGES = ["discover", "analyze", "qualify", "contact", "book", "dispatch", "complete", "pay", "review"];
export const TERMINAL_STAGES = ["review", "dead"];

export function isTerminal(stage) {
  return TERMINAL_STAGES.includes(stage);
}

// Advances a lead by exactly one stage step: runs the current stage's
// handler, persists any patch plus the resulting stage, and appends to
// stage_history on an actual transition. One step per call, deliberately —
// the sweep below calls this once per lead per invocation, so a single cron
// tick can't run a lead through the whole pipeline (and rack up AI/Bland/
// Stripe cost) in one shot; each tick just moves it one stage closer.
export async function advanceLead(lead) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured — workflow needs it to persist lead state.");
  if (isTerminal(lead.stage)) return { lead, advanced: false, note: "Already terminal." };

  const handler = handlers[lead.stage];
  if (!handler) return { lead, advanced: false, note: `No handler for stage "${lead.stage}".` };

  let result;
  try {
    result = await handler(lead);
  } catch (e) {
    result = { stay: true, note: `Stage error: ${e?.message || e}` };
  }

  const patch = result.patch || {};
  const newStage = result.next || lead.stage;
  const history = [...(lead.stage_history || [])];
  if (result.next && result.next !== lead.stage) {
    history.push({ stage: result.next, at: new Date().toISOString(), from: lead.stage });
  }

  const updates = { ...patch, stage: newStage, stage_history: history, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("leads").update(updates).eq("id", lead.id).select().single();
  if (error) throw new Error(`Failed to persist lead ${lead.id}: ${error.message}`);

  return { lead: data, advanced: newStage !== lead.stage, note: result.note };
}

// Cron sweep target: advance every non-terminal lead by one step each.
// Independent leads never block each other — one lead's stage error is
// caught inside advanceLead and surfaced as a `note` on its own result, the
// sweep keeps going for the rest.
export async function sweep(limit = 200) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: leads, error } = await supabase
    .from("leads").select("*")
    .not("stage", "in", `(${TERMINAL_STAGES.join(",")})`)
    .limit(limit);
  if (error) throw new Error(error.message);

  const results = [];
  for (const lead of leads || []) {
    try {
      results.push(await advanceLead(lead));
    } catch (e) {
      results.push({ lead, advanced: false, note: e?.message || String(e) });
    }
  }
  return results;
}
