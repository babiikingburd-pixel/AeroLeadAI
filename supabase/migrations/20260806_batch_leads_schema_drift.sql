-- Reconciles supabase/migrations/ with what is actually in the production
-- database (project dikxsdjlrbdowozjkefw).
--
-- 28 batch_leads columns were added directly against the live database over
-- the course of the APEX 9.x work and never made it into a migration file.
-- The consequence: checking this repo out and applying supabase/migrations/*
-- in order produces a schema the application cannot run against. Two concrete
-- failures, both verified against production:
--
--   * 20260805_apex97_evidence_gate.sql creates an index on
--     (county, sales_status, next_validation_at). next_validation_at is
--     created by no file in this repo, so that migration errors out.
--   * lib/twincities/evidenceDebt.js, fastCycle.js, evidenceFusion.js and
--     apex10_rebuild_leaderboard() all read promotion_streak,
--     image_damage_score, image_visibility_score and validation_*, none of
--     which this repo creates.
--
-- Types and defaults below are transcribed from information_schema on the
-- live database, so applying this to production is a no-op and applying it to
-- a fresh database reproduces production exactly.

-- Scoring / enrichment bookkeeping (priority-worker, gap-router).
alter table batch_leads add column if not exists base_priority_score numeric;
alter table batch_leads add column if not exists score_before_enrichment numeric;
alter table batch_leads add column if not exists score_model text;
alter table batch_leads add column if not exists scored_at timestamptz;
alter table batch_leads add column if not exists tier text;
alter table batch_leads add column if not exists property_class text;
alter table batch_leads add column if not exists campaign text;
alter table batch_leads add column if not exists campaign_multiplier numeric default 1.0;

alter table batch_leads add column if not exists enrichment_status text;
alter table batch_leads add column if not exists enrichment_queue text;
alter table batch_leads add column if not exists enrichment_attempts integer default 0;
alter table batch_leads add column if not exists enrichment_queued_at timestamptz;
alter table batch_leads add column if not exists enrichment_started_at timestamptz;
alter table batch_leads add column if not exists enrichment_completed_at timestamptz;
alter table batch_leads add column if not exists enrichment_worker_id text;

-- Evidence gap router.
alter table batch_leads add column if not exists gap_route text;
alter table batch_leads add column if not exists gap_priority numeric;
alter table batch_leads add column if not exists gap_computed_at timestamptz;

-- Validation worker state. next_validation_at is the one
-- 20260805_apex97_evidence_gate.sql indexes.
alter table batch_leads add column if not exists validation_status text default 'unvalidated';
alter table batch_leads add column if not exists validation_score numeric default 0;
alter table batch_leads add column if not exists validation_confidence numeric default 0;
alter table batch_leads add column if not exists validation_priority numeric default 0;
alter table batch_leads add column if not exists validation_version text;
alter table batch_leads add column if not exists last_validated_at timestamptz;
alter table batch_leads add column if not exists next_validation_at timestamptz;

-- Image review outputs, read by evidenceFusion.js and the leaderboard
-- function. image_evidence_status (retrieval) is created by
-- 20260805_apex97_evidence_gate.sql; these two are the review results.
alter table batch_leads add column if not exists image_damage_score numeric;
alter table batch_leads add column if not exists image_visibility_score numeric;

-- Consecutive qualifying cycles before a lead may be promoted. Consumed by
-- evaluatePromotion() in lib/twincities/evidenceDebt.js and written by
-- apex10_rebuild_leaderboard(); NOT NULL because both treat absence as zero.
alter table batch_leads add column if not exists promotion_streak integer not null default 0;

-- APEX 9.6 wrote image_evidence_status='verified' when an imagery *fetch*
-- succeeded. 9.7 redefined the column as retrieval state only (fetched /
-- failed) and moved assessment to image_review_status — see the column
-- comment in 20260805_apex97_evidence_gate.sql. The rows still carrying the
-- old value were fetched and never reviewed (image_fetched_at set,
-- image_review_status='unreviewed', image_damage_score null), so relabelling
-- them loses nothing and stops buildValidationChecks() from treating them as
-- having a completed imagery review.
update batch_leads
   set image_evidence_status = 'fetched'
 where image_evidence_status = 'verified';
