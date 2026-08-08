# AeroLeadAI APEX 9.7 — Evidence Gate Improvement

This package is an improvement of the supplied APEX 9.6 evidence-gate build.

## What changed

1. **Full-population rotation**
   - APEX 9.6 repeatedly scanned the first 1,000 eligible rows.
   - 9.7 rotates through the entire eligible Twin Cities population, so the remaining ~152K-property population can actually receive scoring attention over repeated cycles.

2. **True global Top 500**
   - The old response labeled the current scan page as `top500`.
   - 9.7 separately queries the persisted global Top 500 after each scoring page and uses that population plus challengers to feed validation.

3. **Hard evidence gate**
   - Downloading imagery is no longer treated as image verification.
   - `image_evidence_status=fetched` means only that imagery was retrieved.
   - `image_review_status=verified` is required before image-review points are awarded.

4. **Checked vs. found**
   - A permit check that returns no record is recorded as `none_found`, not silently conflated with a positive permit finding.
   - Validation completeness and lead quality are kept conceptually separate.

5. **Validation confidence is bounded honestly**
   - A property cannot become fully `validated` merely because permit/assessor checks succeeded and an image was fetched.
   - Actual image review is a required part of the 80+ validation path.

6. **Queue reliability**
   - `attempts` is now actually selected and incremented.
   - Failed jobs return to `queued` with a retry time instead of becoming permanently dead.
   - The missing APEX 9.6 validation/job/audit tables are included in an idempotent migration.

## Install

Run:

`supabase/migrations/20260805_apex97_evidence_gate.sql`

Then keep the existing autonomous cycle/worker running.

## Important

The migration creates the storage and gate fields. It does **not** invent image damage findings. A real image reviewer (AI or human) still needs to write:

- `image_review_status = 'verified'`
- `image_review_confidence`
- optionally the review notes / detection fields used by your UI

That is intentional: the gate prevents fetched imagery from masquerading as verified damage evidence.
