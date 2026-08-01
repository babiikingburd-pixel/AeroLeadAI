import { supabaseServer } from "../../../lib/supabaseServer";

// POST /api/contractor-export
// body: { contractorName: string, zipCode?: string, county?: string, leadIds: string[], tier: 'candidates_500'|'review_100'|'contractor_20' }
//
// Logs the export to contractor_exports (so you know who got which leads,
// when, and can eventually measure close rate per contractor) and marks
// each exported lead's review_status as 'contractor_sent' so it drops out
// of future top-leads pulls for the same territory.

export async function POST(req) {
  const supabase = supabaseServer();
  if (!supabase) return Response.json({ ok: false, error: "Supabase not configured." }, { status: 500 });

  const body = await req.json();
  const { contractorName, zipCode, county, leadIds, tier } = body;

  if (!contractorName || !Array.isArray(leadIds) || leadIds.length === 0) {
    return Response.json({ ok: false, error: "contractorName and non-empty leadIds[] are required." }, { status: 400 });
  }

  const { data: exportRow, error: exportError } = await supabase
    .from("contractor_exports")
    .insert({
      contractor_name: contractorName,
      zip_code: zipCode ?? null,
      county: county ?? null,
      lead_ids: leadIds,
      exported_count: leadIds.length,
      tier: tier ?? null,
    })
    .select()
    .single();

  if (exportError) return Response.json({ ok: false, error: exportError.message }, { status: 500 });

  const { error: updateError } = await supabase
    .from("batch_leads")
    .update({ review_status: "contractor_sent", review_status_updated_at: new Date().toISOString() })
    .in("id", leadIds);

  if (updateError) {
    // The export record already exists even if the status update partially
    // failed — surface both facts rather than silently losing the export log.
    return Response.json({ ok: true, export: exportRow, warning: `Export logged, but marking leads as sent failed: ${updateError.message}` });
  }

  return Response.json({ ok: true, export: exportRow });
}
