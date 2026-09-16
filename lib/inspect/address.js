export function normalizeAddress(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function houseNumber(value) {
  const m = String(value || "").trim().match(/^(\d+)/);
  return m ? m[1] : null;
}

export function isRoofRelated({ workType, permitType, comments, permit_type } = {}) {
  const blob = [workType, permitType, comments, permit_type].filter(Boolean).join(" ").toLowerCase();
  if (!blob) return false;
  return /roof|reroof|re-roof|shingle|tear.?off|tpo|epdm|modified bitumen/.test(blob);
}
