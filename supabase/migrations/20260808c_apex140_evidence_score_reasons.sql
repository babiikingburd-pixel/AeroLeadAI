-- lib/twincities/evidenceEvents.js writes evidence_score_reasons on every
-- rescore (applyEvidenceAndRescore, the one shared function all workers --
-- priority-worker, validation-worker, evidence-cycle, gap-router,
-- storm-backfill -- call). No prior APEX zip's migration created this
-- column, so every rescore call would fail PostgREST's unknown-column
-- check and throw, breaking the entire evidence pipeline. Additive fix.
alter table if exists batch_leads
  add column if not exists evidence_score_reasons jsonb default '[]'::jsonb;
