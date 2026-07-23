import { supabaseServer } from "../supabaseServer";

/**
 * #14 Enterprise & Government Services
 *
 * Adds an `organizations` layer above individual properties so a
 * municipality, property manager, HOA, or insurer can manage many
 * properties under one account with role-scoped admin users and
 * portfolio-wide reporting.
 */

const ROLES = ["org_admin", "org_manager", "org_viewer"];

export async function createOrganization({ name, type, billingContact }) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase.from("organizations").insert({ name, type, billing_contact: billingContact }).select().single();
  if (error) throw new Error(`Organization creation failed: ${error.message}`);
  return data;
}

export async function listOrganizations() {
  const supabase = supabaseServer();
  if (!supabase) return [];
  const { data } = await supabase.from("organizations").select("*").order("created_at", { ascending: false });
  return data || [];
}

export async function addOrgUser(orgId, { email, role }) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role "${role}" — must be one of ${ROLES.join(", ")}`);
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { data, error } = await supabase.from("organization_users").insert({ organization_id: orgId, email, role }).select().single();
  if (error) throw new Error(`Failed to add org user: ${error.message}`);
  return data;
}

/** Attach a property (portfolio unit) to an organization — e.g. an HOA's whole neighborhood. */
export async function addPropertyToOrg(orgId, propertyId) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const { error } = await supabase.from("property_records").update({ organization_id: orgId }).eq("id", propertyId);
  if (error) throw new Error(`Failed to attach property: ${error.message}`);
}

/** Bulk import a portfolio (addresses already parsed by caller) as an org's properties. */
export async function bulkImportPortfolio(orgId, properties) {
  const supabase = supabaseServer();
  if (!supabase) throw new Error("Supabase not configured.");
  const rows = properties.map((p) => ({ address: p.address, lat: p.lat, lon: p.lon, organization_id: orgId, history: [] }));
  const { data, error } = await supabase.from("property_records").insert(rows).select();
  if (error) throw new Error(`Bulk import failed: ${error.message}`);
  return { imported: data.length };
}

/**
 * Portfolio-wide reporting: aggregate open jobs, spend, and flagged quality
 * issues across every property an org owns. Matches jobs to properties by
 * normalized address (this schema doesn't FK jobs to property_records
 * directly — both key off the same address).
 */
export async function getPortfolioReport(orgId) {
  const supabase = supabaseServer();
  if (!supabase) return { property_count: 0, message: "Supabase not configured." };
  const { data: properties } = await supabase.from("property_records").select("address").eq("organization_id", orgId);
  if (!properties?.length) return { property_count: 0, message: "No properties in this organization yet." };

  const addresses = properties.map((p) => p.address);
  const { data: jobs } = await supabase.from("jobs").select("*").in("address", addresses);

  const totalSpend = (jobs || []).reduce((s, j) => s + (j.revenue_actual || j.revenue_estimate || 0), 0);
  const openJobs = (jobs || []).filter((j) => !["completed", "canceled"].includes(j.status)).length;
  const flagged = (jobs || []).filter((j) => j.quality_flag).length;

  return {
    property_count: properties.length,
    total_spend_usd: totalSpend,
    open_jobs: openJobs,
    flagged_jobs: flagged,
  };
}

export function hasPermission(role, action) {
  const permissions = { org_admin: ["view", "edit", "billing", "add_users"], org_manager: ["view", "edit"], org_viewer: ["view"] };
  return (permissions[role] || []).includes(action);
}
