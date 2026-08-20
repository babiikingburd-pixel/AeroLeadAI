# AeroLeadAI APEX 15.0 MAX — GateKeeper Opportunity Command

## Purpose

This release adds a bounded command layer that consolidates the existing evidence, property-intelligence, validation, storm, imagery, permit, and Top-500 signals into a Top-10 opportunity list.

## Contractor priority

**Apex Roofing is contractor priority #1.** The contractor-routing layer is explicitly locked to **Apex Roofing / Apex Roofing & Siding LLC** and explicitly excludes **Apex Exteriors**. The system does not claim that Apex is the #1 property opportunity; property ranking remains evidence-based.

The configured service area is based on the currently identified Minnesota Apex Roofing & Siding business information. The source currently identifies Apple Valley, Minnesota, contractor license BC633682, and service areas including Lakeville, Farmington, Rosemount, Burnsville, Prior Lake, Eagan, Bloomington and Richfield. See the official site: https://www.apexroofingandsiding.net/

## Top-10 engine

The command layer ranks a bounded candidate pool using existing fields only:

- existing `priority_score` — anchor signal
- `evidence_score`
- `assessed_value` when present
- `roof_visual_score` when present
- `validation_score` when present
- evidence completeness
- storm/weather signal when present

It does not manufacture missing data. Missing values contribute through neutral normalization rather than invented measurements.

## GateKeeper boundary

The GateKeeper package was executed against this upgrade plan. Its v2.3 assessment passed its extended audit with evidence, and its investigation engine completed with `BUILDABLE-NOW`, score 1.0, confidence 1.0, reproducibility 1.0, and no contradictions. The GateKeeper also correctly identified that a generic investigation does not prove a live production Supabase deployment.

The local GateKeeper core tests that completed in this environment passed: `test_engine.py` (2/2), `test_engine_v2.py` (7/7), and `test_memory_archive.py` (8/8). The full suite did not complete within the execution window, and `test_session_driver.py` timed out in this environment. Therefore this release is **GateKeeper-assessed as BUILDABLE-NOW, not falsely labeled production-verified**.

## Operational endpoints

- `GET /api/opportunities/top10`
- UI: `/apex-roofing`
- Migration: `supabase/migrations/20260813_apex150_apex_roofing_top10.sql`
