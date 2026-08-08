# AeroLeadAI APEX 10.2 — Evidence Acceleration

This build advances the Top-500 pipeline from a simple image queue to an evidence-solidification cycle.

## Implemented
1. Top-ranked candidates are selected by `priority_score DESC, confidence_score DESC`.
2. Image crawling races Google/Mapbox/Esri instead of serially waiting on each provider.
3. First usable imagery is persisted immediately.
4. Top-500 image crawler runs in bounded parallel batches.
5. Top-leads now returns the best persisted image URL.
6. Full permit history fields are added to `batch_leads`.
7. Permit history is retained as records; the old 10-year field remains only as a derived scoring signal.
8. Weather evidence is persisted separately from current score fields.
9. Validation imagery is no longer skipped merely because a recent permit exists.
10. New `/api/twincities/evidence-cycle` processes highest-ranked candidates through permit + weather + imagery and triggers the existing rescore path.
11. Dashboard has a `Solidify Top 500` action and a Top-500 image crawler action.

## Supabase
Apply:
`supabase/migrations/20260808_apex102_evidence_pipeline.sql`

The migration is additive and uses `IF NOT EXISTS`.

## Important
Provider/API availability still depends on the configured keys and the provider's coverage. The code does not fabricate imagery, permit records, weather history, or damage findings.
