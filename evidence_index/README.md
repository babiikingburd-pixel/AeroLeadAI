# Evidence Index — restructured (engines/enrichers, not chapters)

Six modules built this weekend, per scope: `evidence_engine`,
`confidence_engine`, `opportunity_engine`, `human_review`,
`storm_overlay`, `county_enricher`. Everything else (services/, exports/,
per-county modules, database sync, tests beyond the six) intentionally
not built — the brief says that waits until this pipeline proves itself
on real leads.

```
python3 main.py          # runs the example pipeline end to end
python3 -m pytest tests/ -v   # 9 passing tests against the six modules
```

## Two real bugs I fixed rather than ported forward

**1. Opportunity/review scale mismatch.** The original `chapter_4`
formula (`property_value*0.4 + roof_estimate*0.3`) produces raw dollar
figures — a real $320k home alone scores ~133,400. The original
`chapter_5` compares opportunity against a `>= 75` threshold. Combined
as-is, **every single real property would trigger human review on
opportunity alone, always** — I verified this with the actual numbers
before writing anything (see the demo output below). Fixed by having
`opportunity_engine` return both `raw_dollars` (real, for display/export)
and a `normalized` 0-100 score (for the review threshold to compare
against sanely). See `opportunity_engine.py`'s docstring.

```
opportunity_score on a typical $320k home: 133400.0
chapter_5 human_review threshold for opportunity: >= 75
=> every single real property would trigger review on opportunity alone, every time
```

**2. `county_multiplier` as an addend.** Your data-flow doc lists
`opportunity = property_value + roof_estimate + county_multiplier +
ancillary_services` — literally summed, a multiplier of 1.0 would add a
flat $1 regardless of property size, and a multiplier of 50 would add
exactly $50 whether the property is worth $50k or $5M. Applied
multiplicatively to the base estimate instead, which is what "multiplier"
functionally means. Flagged in `opportunity_engine.py`'s docstring rather
than silently changed.

## What's real vs. intentionally neutral

| Piece | Status |
|---|---|
| Maturity tiers, storm point thresholds, review thresholds | Real, ported from your original chapters |
| `storm_overlay.py` | Real NWS/NOAA API integration (`api.weather.gov`, free/keyless) — pulls active alerts, regex-parses real hail size/wind speed out of real alert text, degrades to "no storm evidence" on any API failure rather than crashing or faking data |
| `county_enricher.py` matching logic | Real |
| `county_enricher.py` multiplier **values** | Neutral 1.0 for all six counties — no real closed-deal history exists yet to learn them from. Same principle as AeroLeadAI's JS `county_weights` table; once this pipeline (or a shared data store with that system) has outcome data, replace these the same way, never hand-tune a number here |
| Ancillary service point values (tree/gutter/driveway) | Real, working, but starting weights — your original chapters had no ancillary formula to port, so these are documented initial values (same order of magnitude as the storm flags) pending real effect-size data |

## What's next (not built, per scope)

`permit_enricher.py`, `property_value.py`, `imagery_enricher.py` upstream;
`scoring_engine.py` (the weighted 50/25/25 combine — not built since it
wasn't in the six requested), `services/`, `counties/` (per-county
modules beyond the shared `county_enricher`), `exports/`, `database/`.
`main.py`'s `run_pipeline()` is written so a lead dict from those future
enrichers slots in without changing the six built modules.
