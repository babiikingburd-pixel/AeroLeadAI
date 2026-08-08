# APEX 10.3 — Complete Evidence Build

This ZIP is cumulative from APEX 10.2.

## Permanent pipeline contract
Every future AeroLeadAI build must carry forward all previous working features. New evidence layers are additive and persist in the same database.

## Evidence order
1. Property overview image
2. Permit history (all discovered permits)
3. Property value / assessor evidence
4. Storm history
5. Weather exposure
6. Roof visual evidence
7. Driveway visual evidence
8. Exterior visual evidence
9. Grounds / maintenance visual evidence
10. Evidence completeness/confidence
11. Re-score
12. Re-rank Top 500

## Important data rule
Unknown is never treated as false. A permit is stored as a history record when found, regardless of age.

## Visual evidence
APEX 10.3 adds durable jobs for property, roof, driveway, exterior, and grounds crops. It preserves source imagery and provides an Evidence Gallery contract. Actual crop generation must use a configured image-processing backend; the application does not fabricate or hallucinate property conditions.

## Deployment
Apply both additive SQL migrations:
- `supabase/migrations/20260808_apex102_evidence_pipeline.sql`
- `supabase/migrations/20260808_apex103_complete_evidence.sql`
