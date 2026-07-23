import { supabaseServer } from "../supabaseServer";

// Supabase-backed replacement for the original in-memory Map registry (see
// decisions/decision_reports in supabase_phase2_schema.sql) — same
// get/create/update/isStuck/list shape the Boardroom expects, but persisted
// so decisions survive across serverless invocations instead of living only
// in one warm Lambda's memory.
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    question: row.question,
    proposedAction: row.proposed_action,
    dependsOn: row.depends_on,
    status: row.status,
    result: row.result,
    second_opinion: row.second_opinion,
    human_resolution: row.human_resolution,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class DecisionRegistry {
  async create({ id, question, proposedAction, dependsOn = null }) {
    const supabase = supabaseServer();
    if (!supabase) throw new Error("Supabase is not configured — the Executive Engine needs it to persist decisions.");
    const { data, error } = await supabase
      .from("decisions")
      .insert({ id, question, proposed_action: proposedAction, depends_on: dependsOn, status: "pending" })
      .select()
      .single();
    if (error) throw new Error(`Failed to create decision "${id}": ${error.message}`);
    return mapRow(data);
  }

  async get(id) {
    const supabase = supabaseServer();
    if (!supabase) return null;
    const { data } = await supabase.from("decisions").select("*").eq("id", id).maybeSingle();
    return mapRow(data);
  }

  async update(id, patch) {
    const supabase = supabaseServer();
    if (!supabase) throw new Error("Supabase is not configured.");
    const dbPatch = { updated_at: new Date().toISOString() };
    if ("status" in patch) dbPatch.status = patch.status;
    if ("result" in patch) dbPatch.result = patch.result;
    if ("second_opinion" in patch) dbPatch.second_opinion = patch.second_opinion;
    if ("human_resolution" in patch) dbPatch.human_resolution = patch.human_resolution;
    const { data, error } = await supabase.from("decisions").update(dbPatch).eq("id", id).select().single();
    if (error) throw new Error(`Failed to update decision "${id}": ${error.message}`);
    return mapRow(data);
  }

  async isStuck(id) {
    const d = await this.get(id);
    return d ? d.status === "escalated" : false;
  }

  async list({ status } = {}) {
    const supabase = supabaseServer();
    if (!supabase) return [];
    let query = supabase.from("decisions").select("*").order("created_at", { ascending: false }).limit(200);
    if (status) query = query.eq("status", status);
    const { data } = await query;
    return (data || []).map(mapRow);
  }
}
