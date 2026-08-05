/**
 * VALIDATION CAPABILITY REGISTRY
 *
 * The single source of truth for "can this evidence dimension actually be
 * checked right now, and how." Exists because the system was silently
 * treating "we didn't check" the same as "we checked and found nothing" —
 * this registry makes the difference between "no validator exists yet" and
 * "validator exists but this attempt found nothing" explicit and queryable,
 * instead of both looking like an empty result.
 *
 * status meanings:
 *   'working'    — real, tested, per-lead on-demand capability exists
 *   'bulk_only'  — real capability exists, but only as a batch operation
 *                  (checking one lead on demand would be wasteful or
 *                  impossible given the source's actual shape)
 *   'broken'     — code exists and was built to do this, but is confirmed
 *                  non-functional (e.g. unverified endpoints)
 *   'missing'    — no implementation exists at all yet
 *
 * VERIFIED THIS SESSION, not assumed:
 *   - permit: real Shovels.ai integration, tested request/response shape
 *   - storm: NOAA NCEI ships as annual CSV.gz files (megabytes each) —
 *     downloading and parsing a full year's file to check ONE lead's
 *     coordinates would be wasteful to the point of impractical. This is a
 *     genuine bulk-only source, not a missing feature — see storm-backfill's
 *     priority-ordering support instead of a fake per-lead NOAA call.
 *   - value: sync-assessor-data exists and is real plumbing, but all six
 *     county ArcGIS URLs are confirmed-broken guesses (live-tested this
 *     session: 3 of 6 failed with SSL errors/timeouts, 0 rows ever enriched
 *     in production). Real code, broken data source.
 *   - image: imagery-agent fetches a photo. Nothing reviews it — no
 *     damage_notes, no AI or human confirmation step writes back from it.
 *     Fetch exists; validation does not.
 */

export const VALIDATION_CAPABILITIES = {
  permit: {
    status: "working",
    dimension: "permit_evidence_status",
    checkedAtField: "permit_checked_at",
    notes: "Shovels.ai via GET /api/permit-lookup. Needs PERMIT_API_KEY set to find anything beyond the manual directory.",
  },
  storm: {
    status: "bulk_only",
    dimension: "storm_evidence_status",
    checkedAtField: "storm_date", // not a true "checked_at", but the closest signal available
    notes: "NOAA NCEI ships as annual CSV.gz files — real per-lead capability would mean re-downloading/parsing a multi-MB file per lead. Use storm-backfill's priority-first mode instead of pretending this is on-demand.",
  },
  value: {
    status: "broken",
    dimension: "value_evidence_status",
    checkedAtField: "value_checked_at",
    notes: "sync-assessor-data's county ArcGIS URLs are unverified guesses. Confirmed broken: 3 of 6 counties live-tested, all failed. 0 rows ever enriched. Real endpoints need to be found and swapped in — see COUNTY_PARCEL_URLS in that route.",
  },
  image: {
    status: "missing",
    dimension: "image_evidence_status",
    checkedAtField: "image_fetched_at",
    notes: "imagery-agent fetches a photo but nothing reviews it. A validation step (human review UI, or an AI damage-detection call) needs to be built — the fetch alone doesn't produce evidence a score can use.",
  },
};

export function capabilityFor(dimensionKey) {
  return VALIDATION_CAPABILITIES[dimensionKey] || null;
}

export function workingDimensions() {
  return Object.entries(VALIDATION_CAPABILITIES)
    .filter(([, v]) => v.status === "working")
    .map(([k]) => k);
}

export function gapSummary() {
  return Object.entries(VALIDATION_CAPABILITIES)
    .filter(([, v]) => v.status !== "working")
    .map(([k, v]) => ({ dimension: k, status: v.status, notes: v.notes }));
}
