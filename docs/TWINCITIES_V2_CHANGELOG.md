# Aero Lead AI — Twin Cities V2 Fast Validation Changelog

Date: 2026-08-04

## Objective

Reduce time from Minneapolis/Twin Cities candidate discovery -> score -> validation -> ranking propagation, while preventing the dashboard from causing a large scoring/write burst.

## Seven improvements

1. **Read-only ranking path**
   `/api/top-leads` now reads persisted ranking state instead of recalculating and writing hundreds of rows on every GET.

2. **Fast bounded scoring cycle**
   `/api/twincities/fast-cycle` selects only required fields, scores a bounded six-county batch, and persists scores in small chunks.

3. **Evidence-gap validation priority**
   Candidates are prioritized by score, evidence gap, freshness, and unresolved validation state.

4. **Bounded concurrent validation**
   Permit and assessor checks run concurrently; imagery is gated behind the permit result. Worker concurrency is capped at four to avoid recreating the database/network burst problem.

5. **Immediate evidence -> score propagation**
   New evidence goes through the existing `applyEvidenceAndRescore()` path, so the score changes immediately rather than waiting for a later dashboard refresh.

6. **Living Top-500 challenger band**
   Each fast cycle queues the current Top 500 plus a wider challenger band. A challenger can replace #500 after validation changes its score.

7. **Autonomous continuous driver**
   `/api/twincities/autonomous-cycle` runs score -> validate -> reread the current Top 500. A Vercel cron provides a safety-net run; `workers/twincities_autonomous_worker.py` can run the cycle every few minutes outside Vercel for true continuous operation.

## New files

- `lib/twincities/fastCycle.js`
- `app/api/twincities/fast-cycle/route.js`
- `app/api/twincities/validation-worker/route.js`
- `app/api/twincities/autonomous-cycle/route.js`
- `supabase/migrations/20260804_twincities_autonomous_validation.sql`
- `workers/twincities_autonomous_worker.py`

## Modified

- `app/api/top-leads/route.js`
- `lib/twincities/evidenceEvents.js`
- `vercel.json`

## Database step

Run the new migration before invoking the new routes.

## Important production note

The current repository still contains county GIS endpoint mappings documented in the existing code as unverified. This V2 improves the speed and routing of validation; it does not pretend those external endpoints are valid. The validator records failed/unknown evidence rather than converting it into a positive fact.
