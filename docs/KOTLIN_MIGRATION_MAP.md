# APEX 9.6 Kotlin migration map

| Original area | Kotlin destination |
|---|---|
| evidenceIndex engines | `evidence/EvidenceEngine.kt` |
| Twin Cities priority logic | `scoring/PriorityEngine.kt` |
| validation prioritization | `validation/ValidationPlanner.kt` |
| experiment evaluation | `selfimprovement/Experiment.kt` |
| build/doctor concepts | `build/BuildDoctor.kt` |
| original JS/Python | `legacy-reference/` |
| SQL | `supabase/` |

The migration is deliberately incremental: core business logic is ported first, while the original implementation is retained for parity testing. This avoids silently changing production behavior during a language rewrite.
