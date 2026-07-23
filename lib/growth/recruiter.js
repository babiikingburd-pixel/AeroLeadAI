import { supabaseServer } from "../supabaseServer";

/**
 * #10 Autonomous Contractor Growth Engine
 *
 * Real parts: candidate intake, license/insurance verification calls,
 * automated onboarding into the live `contractors` table, and a monitoring
 * sweep that suspends contractors whose insurance has lapsed or whose
 * performance has dropped below threshold.
 *
 * NOT fabricated but NOT fully autonomous: "recruits" means processing
 * inbound applicants (a signup form / an imported directory list) — it does
 * not itself go find contractors on the internet. That needs a licensed
 * contractor-directory data source, which isn't wired in.
 */

export async function submitCandidate({ businessName, phone, email, licenseNumber, licenseState, insuranceDocUrl, serviceTypes }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase
    .from("contractor_candidates")
    .insert({
      business_name: businessName, phone, email,
      license_number: licenseNumber, license_state: licenseState,
      insurance_doc_url: insuranceDocUrl, service_types: serviceTypes || [],
      status: "pending_verification",
    })
    .select().single();
  if (error) throw new Error(`Candidate submission failed: ${error.message}`);
  return data;
}

export async function listCandidates(status) {
  const supabase = supabaseServer();
  if (!supabase) return [];
  let query = supabase.from("contractor_candidates").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data } = await query;
  return data || [];
}

/**
 * License verification needs a paid aggregator (Berbix, Middesk, or a
 * state-specific API) — none is wired in. Calls a pluggable verifier so a
 * real one can be dropped in via env vars without touching the pipeline.
 */
export async function verifyCandidate(candidateId) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: candidate, error } = await supabase.from("contractor_candidates").select("*").eq("id", candidateId).single();
  if (error || !candidate) throw new Error("Candidate not found");

  const licenseResult = await verifyLicense(candidate.license_number, candidate.license_state);
  const insuranceResult = await verifyInsuranceDoc(candidate.insurance_doc_url);
  const verified = licenseResult.valid && insuranceResult.valid;
  const status = verified ? "verified" : "rejected";

  await supabase.from("contractor_candidates").update({
    status, license_verified: licenseResult.valid, insurance_verified: insuranceResult.valid,
    verification_notes: `${licenseResult.note || ""} ${insuranceResult.note || ""}`.trim(),
    verified_at: new Date().toISOString(),
  }).eq("id", candidateId);

  return { verified, licenseResult, insuranceResult };
}

async function verifyLicense(licenseNumber, state) {
  if (!process.env.LICENSE_VERIFICATION_API_KEY) {
    return { valid: null, note: "No license verification provider configured — manual review required." };
  }
  try {
    const res = await fetch(`${process.env.LICENSE_VERIFICATION_API_URL}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.LICENSE_VERIFICATION_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ license_number: licenseNumber, state }),
    });
    if (!res.ok) return { valid: null, note: `Verification provider error: ${res.status}` };
    const data = await res.json();
    return { valid: !!data.active, note: data.status || "" };
  } catch (e) {
    return { valid: null, note: "Verification provider unreachable: " + e.message };
  }
}

async function verifyInsuranceDoc(docUrl) {
  if (!docUrl) return { valid: false, note: "No insurance document submitted." };
  try {
    const res = await fetch(docUrl, { method: "HEAD" });
    return { valid: res.ok, note: res.ok ? "Document present, not yet expiration-verified." : "Document unreachable." };
  } catch {
    return { valid: false, note: "Document unreachable." };
  }
}

/** Promote a verified candidate into the live `contractors` table. */
export async function onboardCandidate(candidateId) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data: candidate } = await supabase.from("contractor_candidates").select("*").eq("id", candidateId).single();
  if (!candidate || candidate.status !== "verified") throw new Error("Candidate must be verified before onboarding");

  const { data: contractor, error } = await supabase
    .from("contractors")
    .insert({
      name: candidate.business_name, phone: candidate.phone, email: candidate.email,
      service_types: candidate.service_types, license_number: candidate.license_number,
      license_state: candidate.license_state, active: true,
    })
    .select().single();
  if (error) throw new Error(`Onboarding failed: ${error.message}`);

  await supabase.from("contractor_candidates").update({ status: "onboarded", contractor_id: contractor.id }).eq("id", candidateId);
  return contractor;
}

/**
 * Monitoring sweep: suspends contractors whose insurance doc is past its
 * stored expiration date, or whose completion rate has cratered (uses the
 * same jobs/contractors query as lib/businessIntelligence.js's
 * contractorPerformance() rather than a separately-maintained score column,
 * so there's one source of truth for "how is this contractor doing").
 */
export async function runMonitoringSweep() {
  const supabase = supabaseServer();
  if (!supabase) return { checked: 0, suspended: [] };
  const { data: contractors } = await supabase.from("contractors").select("*").eq("active", true);
  const { data: jobs } = await supabase.from("jobs").select("contractor_id, status");
  const suspended = [];

  for (const c of contractors || []) {
    const reasons = [];
    if (c.insurance_expires_at && new Date(c.insurance_expires_at) < new Date()) reasons.push("insurance expired");

    const cJobs = (jobs || []).filter((j) => j.contractor_id === c.id);
    const completed = cJobs.filter((j) => j.status === "completed").length;
    const canceled = cJobs.filter((j) => j.status === "canceled").length;
    if (cJobs.length >= 5 && canceled / cJobs.length > 0.5) reasons.push(`high cancellation rate (${canceled}/${cJobs.length})`);

    if (reasons.length) {
      await supabase.from("contractors").update({ active: false, suspension_reason: reasons.join("; ") }).eq("id", c.id);
      suspended.push({ id: c.id, name: c.name, reasons });
    }
  }
  return { checked: contractors?.length || 0, suspended };
}
