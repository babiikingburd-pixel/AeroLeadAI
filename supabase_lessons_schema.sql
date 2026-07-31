-- AeroLeadAI Lesson Engine Schema
-- Run after supabase_autonomy_schema.sql.
--
-- The distinction that matters: predictions+corrections are MEMORY (what
-- happened). This table is KNOWLEDGE (a pattern extracted from enough of
-- that memory to be worth acting on). A lesson only gets written when
-- there's real evidence behind it — evidence_count and confidence are not
-- decorative, they're what stops this table from filling up with noise
-- extracted from 2 data points.

create table if not exists learned_lessons (
  lesson_id uuid primary key default gen_random_uuid(),
  domain text,                        -- 'roof' | 'tree' | 'driveway' | 'snow_load' | null (cross-domain)
  lesson text not null,                -- human-readable pattern statement
  lesson_type text,                    -- 'age_correlation' | 'permit_signal' | 'overestimate_pattern' |
                                        -- 'geographic_signal' | 'confidence_adjustment'
  confidence float,                    -- 0-1, how strong the pattern is given the evidence
  evidence_count int not null,         -- how many corrections/predictions this was derived from
  supporting_correction_ids uuid[],    -- traceable back to the actual corrections, not just asserted
  active boolean default true,         -- teacher agent can retire a lesson if it stops holding up
  superseded_by uuid references learned_lessons(lesson_id),
  created_at timestamptz default now(),
  last_validated_at timestamptz
);

create index if not exists idx_learned_lessons_domain on learned_lessons (domain) where active = true;

alter table learned_lessons enable row level security;
do $$
begin
  execute 'drop policy if exists "Allow anon read" on learned_lessons';
  execute 'create policy "Allow anon read" on learned_lessons for select using (true)';
  execute 'drop policy if exists "Allow anon insert" on learned_lessons';
  execute 'create policy "Allow anon insert" on learned_lessons for insert with check (true)';
  execute 'drop policy if exists "Allow anon update" on learned_lessons';
  execute 'create policy "Allow anon update" on learned_lessons for update using (true)';
end $$;

-- =========================================================================
-- HONEST GAP: a lesson is only as good as the pattern-detection that wrote
-- it. The lesson-generation job (see /api/lesson-engine) uses simple,
-- explainable statistical rules (grouping corrections by a shared
-- attribute and checking if the average error differs meaningfully from
-- the baseline) — NOT a black-box model discovering patterns no one can
-- verify. Every lesson traces back to supporting_correction_ids so a human
-- can always check the underlying evidence, not just trust the sentence.
-- =========================================================================

-- =========================================================================
-- EXPERIMENTS — the Scientist Agent's ledger. A pattern that JUST crossed
-- the minimum evidence threshold isn't trustworthy yet; it's a hypothesis.
-- This table tracks it across multiple lesson-engine runs and only lets it
-- graduate to learned_lessons (active=true) once re-measurement with MORE
-- evidence still shows the same pattern. If the pattern flips or vanishes
-- as more data comes in, it's marked refuted and never promoted — this is
-- what makes "runs experiments, tracks success rates" real instead of a
-- single-measurement guess dressed up as science.
-- =========================================================================
-- Named lesson_experiments, not experiments: this database already has an
-- unrelated A/B-testing "experiments" table (business_id/control/variant
-- conversion columns). Reusing that name would silently no-op against the
-- existing table instead of creating this one.
create table if not exists lesson_experiments (
  experiment_id uuid primary key default gen_random_uuid(),
  hypothesis text not null,
  lesson_type text,
  domain text,
  status text default 'testing',      -- 'testing' | 'confirmed' | 'refuted'
  initial_evidence_count int not null,
  current_evidence_count int not null,
  initial_effect_size numeric,        -- the measured bias/swing at first detection
  current_effect_size numeric,        -- re-measured value on latest check
  check_count int default 1,
  started_at timestamptz default now(),
  last_checked_at timestamptz default now(),
  resolved_at timestamptz,
  promoted_lesson_id uuid references learned_lessons(lesson_id)
);

create index if not exists idx_lesson_experiments_status on lesson_experiments (status) where status = 'testing';

alter table lesson_experiments enable row level security;
do $$
begin
  execute 'drop policy if exists "Allow anon read" on lesson_experiments';
  execute 'create policy "Allow anon read" on lesson_experiments for select using (true)';
  execute 'drop policy if exists "Allow anon insert" on lesson_experiments';
  execute 'create policy "Allow anon insert" on lesson_experiments for insert with check (true)';
  execute 'drop policy if exists "Allow anon update" on lesson_experiments';
  execute 'create policy "Allow anon update" on lesson_experiments for update using (true)';
end $$;
