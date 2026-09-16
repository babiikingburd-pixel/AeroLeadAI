import { isRoofRelated, normalizeAddress } from "./address";

export async function loadPermitIndex(supabase, addresses) {
  const index = new Map();
  if (!supabase || !addresses?.length) return index;

  const wanted = new Set(addresses.map(normalizeAddress).filter(Boolean));
  const { data, error } = await supabase
    .from("permits")
    .select("address,permit_type,permit_number,issue_date,status,roof_related,notes")
    .limit(4000);

  if (error) return index;

  for (const row of data || []) {
    const key = normalizeAddress(row.address);
    if (!wanted.has(key)) continue;
    const issueYear = row.issue_date ? Number(String(row.issue_date).slice(0, 4)) : null;
    const item = {
      address: row.address,
      permitNumber: row.permit_number,
      permitType: row.permit_type,
      status: row.status,
      issueDate: row.issue_date,
      issueYear: Number.isFinite(issueYear) ? issueYear : null,
      roofRelated: row.roof_related === true || isRoofRelated(row),
      source: "supabase-permits",
    };
    const list = index.get(key) || [];
    list.push(item);
    index.set(key, list);
  }
  return index;
}

export function permitSummary(list = []) {
  const roof = list.filter((r) => r.roofRelated);
  const years = roof.map((r) => r.issueYear).filter((y) => Number.isFinite(y));
  return {
    status: list.length ? "matched" : "none_on_file",
    historyCount: list.length,
    roofCount: roof.length,
    lastReroofYear: years.length ? Math.max(...years) : null,
  };
}
