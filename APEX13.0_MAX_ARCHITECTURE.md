# AeroLeadAI APEX 13.0 MAX

APEX 13.0 MAX is cumulative from every prior build. It does not replace or remove prior functionality.

## What 13.0 adds

### 1. Property Digital Twin
A normalized property state assembled from:
- current imagery
- historical imagery
- roof/driveway/exterior/grounds/tree/utility evidence
- permits
- assessor/property value
- storm/weather
- prior evidence snapshots

### 2. Evidence Graph
Every score can trace to:
score -> factor -> finding -> source -> image/record -> date -> confidence.

### 3. Change Detection Engine
Stores property states across time and detects meaningful changes instead of merely collecting old photos.

### 4. Evidence Reliability Engine
Separates:
- verified
- probable
- possible
- conflicting
- unknown
- not visible

Reliability is attached to each finding.

### 5. Autonomous Research Loop
Properties cycle through:
rank -> acquire -> validate -> enrich -> compare -> score -> snapshot -> rerank.

Weak evidence automatically generates follow-up work.

### 6. Hazard Relationship Engine
Relationships can be scored, not just objects:
- tree ↔ power line
- tree ↔ roof
- tree ↔ driveway
- storm ↔ tree damage
- storm ↔ roof evidence
- maintenance ↔ property value
- permit ↔ observed exterior change

### 7. Evidence-Aware Lead Prioritization
Priority considers opportunity plus evidence quality. A high-value property with weak evidence is not treated the same as a high-value property with strong verified evidence.

### 8. Explainable Property Dossier
A property can be opened and inspected as a complete evidence package with source, date, confidence, images, changes, hazards and score reasoning.

### 9. Continuous Recheck Scheduling
Properties receive a next-review time based on:
- evidence age
- evidence weakness
- storm events
- score volatility
- historical change
- hazard indicators

### 10. Data Quality Firewall
Unknown, missing, stale, conflicting and default values cannot silently masquerade as verified facts.

## 13.0 operating philosophy

Evidence first. Scoring second.

The system never manufactures imagery, permits, storm events, tree hazards, utility hazards or property facts. If evidence is unavailable, it records the uncertainty and schedules additional work where appropriate.

## 13.0 does NOT certify:
- electrical safety
- arborist safety
- structural engineering
- roofing condition
- code compliance

It provides property-intelligence screening with traceable evidence.
