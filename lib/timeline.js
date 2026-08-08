// Item #2: property timeline. Any dated event on a property goes through
// addTimelineEvent — permits, sales, violations, inspections, etc. all use
// the same table so the console can render one chronological feed per
// property instead of five separate lookups.

import { supabaseGet, supabasePost } from "./supabaseRest";

const VALID_TYPES = new Set([
  "permit", "ownership_transfer", "assessment_change", "code_violation",
  "renovation", "sale", "inspection", "listing", "zoning_change", "other",
]);

export async function addTimelineEvent({ propertyId, eventType, eventDate, title, detail, source = "manual", sourceRef }) {
  if (!propertyId || !eventDate || !title) return { ok: false, error: "propertyId, eventDate, title required" };
  const type = VALID_TYPES.has(eventType) ? eventType : "other";
  return supabasePost("property_timeline", [{
    property_id: propertyId, event_type: type, event_date: eventDate,
    title, detail: detail ?? null, source, source_ref: sourceRef ?? null,
  }]);
}

export async function getTimeline(propertyId, limit = 100) {
  return supabaseGet(`property_timeline?property_id=eq.${propertyId}&select=*&order=event_date.desc&limit=${limit}`);
}
