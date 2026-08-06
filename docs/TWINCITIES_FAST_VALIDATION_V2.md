# Twin Cities Fast Validation V2

The Minneapolis/Twin Cities scoring path is now split into fast scoring, validation, and autonomous propagation.

## Seven improvements implemented

1. Read-only ranking endpoint: `/api/top-leads` no longer recalculates and writes hundreds of rows on every refresh.
2. Bounded fast scoring: `/api/twincities/fast-cycle` selects only needed fields, scores a bounded set, and chunks writes.
3. Validation priority queue: score, evidence gap, freshness, and unresolved state determine priority.
4. Concurrent validation: permit and assessor work run concurrently; imagery waits for the permit gate.
5. Immediate rescore propagation: evidence flows through the existing shared `applyEvidenceAndRescore` function.
6. Living Top-500 challenger band: the fast cycle queues the Top 500 plus a wider challenger population.
7. Autonomous driver: Vercel cron plus an external Python loop can keep the cycle running without a button.

Run `supabase/migrations/20260804_twincities_autonomous_validation.sql` before using the new routes.

For external continuous operation, set `AERO_BASE_URL`, `CRON_SECRET` if configured, and optionally `AERO_TC_INTERVAL_SECONDS` (default 300), then run `workers/twincities_autonomous_worker.py`.
