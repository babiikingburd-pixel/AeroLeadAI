# AeroLeadAI APEX 11.2 → 12.0 Hazard Intelligence Master Specification

## Permanent one-ZIP rule
Every future release is cumulative. The newest ZIP contains the complete prior runnable codebase and all implemented functionality.

## 11.2 — Tree & Vegetation Evidence Foundation
- Tree/vegetation as a first-class evidence category
- Current property imagery linked to tree evidence
- Tree evidence crops/jobs
- Dead/dying indication
- Fallen/broken limb indication
- Leaning-tree indication
- Overgrowth/encroachment indication
- Tree evidence confidence
- Unknown is distinct from no hazard

## 11.3 — Tree Condition Intelligence
- Current tree condition classification
- Tree count estimate where imagery supports it
- Canopy-loss signal
- Dead/dying visual signal
- Broken/hanging-limb signal
- Fallen-tree signal
- Tree maintenance/vegetation score
- Evidence image for each finding

## 11.4 — Storm-Damaged Tree Intelligence
- Storm-event association
- Wind/hail/heavy-rain evidence
- Post-storm tree evidence
- Before/after evidence when available
- Storm-related change confidence
- Event/date provenance

## 11.5 — Tree Geometry & Proximity
- Tree-to-roof proximity
- Tree-to-structure proximity
- Tree-to-driveway proximity
- Tree-to-vehicle-area proximity
- Tree-to-visible-utility proximity
- Potential obstruction signals
- Geometry/proximity confidence

## 11.6 — Power-Line & Utility Intelligence
- Overhead power-line evidence
- Utility-pole evidence
- Visible service-drop evidence
- Tree/line proximity
- Tree/line overlap/encroachment indication
- Broken limb near visible line
- Dead/fallen tree near visible line
- Potential utility conflict
- Utility evidence images
- Utility confidence

Important: imagery can identify a potential visual conflict; it cannot certify electrical danger. Professional verification remains required.

## 11.7 — Property Maintenance Fusion
- Roof condition signal
- Driveway condition signal
- Exterior condition signal
- Grounds/vegetation signal
- Tree condition signal
- Utility/line conflict signal
- Unified maintenance score
- Evidence completeness/confidence

## 11.8 — Historical Change Detection
Default:
- Current image
- approximately 2 years prior
- approximately 4 years prior

Deep Dive:
- approximately 2-year intervals over a 10-year span
- Current, -2, -4, -6, -8, -10 years when imagery exists

The system uses the best available imagery near the target date and records actual capture dates. Missing imagery is recorded as unknown.

Change targets:
- tree growth
- canopy loss
- tree removal
- new trees
- limb loss
- increasing lean
- vegetation encroachment
- driveway obstruction
- roof/structure proximity changes
- utility/vegetation relationship changes

## 11.9 — Hazard Evidence Verification
- Multi-source image comparison
- Image-quality gate
- Property-match confidence
- Historical-image date confidence
- Evidence provenance
- Conflict detection
- Unknown/insufficient-evidence state
- Evidence snapshots
- Explainable hazard findings

## 12.0 — Unified Property Hazard Intelligence
Every prioritized property receives a unified dossier containing, where evidence exists:

1. Property overview
2. Roof
3. Driveway
4. Exterior
5. Grounds
6. Trees
7. Power lines/utilities
8. Storm exposure
9. Weather history
10. Permit history
11. Property/assessor value
12. Historical imagery
13. Evidence confidence
14. Evidence completeness
15. Score breakdown
16. Historical changes
17. Potential hazards
18. Recommended verification priority

## Scoring principle
No image or source may manufacture a conclusion. "Unknown", "not visible", "not found", and "no apparent evidence" remain separate states where appropriate.

The scoring engine should use only evidence that has a provenance and confidence value, and should preserve the evidence that caused a score change.

## Top-500 operation
The system processes properties in rank order, enriches them, saves evidence, rescoring them after enrichment, and dynamically re-ranks the population. A property with stronger verified evidence may replace a weaker property in the Top 500.

## Image operation
Image acquisition should race configured providers, accept the first valid property-matched image, preserve the source and capture metadata, and queue specialized crops for roof, driveway, exterior, grounds, tree, and utility evidence.

## Safety/defensibility
The system is a property-intelligence screening system. It should not represent image-only findings as certified arborist, electrical, structural, roofing, or engineering determinations.
