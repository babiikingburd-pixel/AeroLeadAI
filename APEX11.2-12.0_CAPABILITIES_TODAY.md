# What the AeroLeadAI architecture is capable of today

## Fully implemented/available in the current 11.1 MAX foundation
- Cumulative Top-500 ranking
- Evidence enrichment cycle
- Property imagery acquisition
- Competing imagery providers
- Image retry logic
- Property coordinate validation
- Persistent property images
- Evidence completeness
- Evidence confidence
- Permit history persistence
- Permit age/history separation
- Property value evidence
- Storm/weather evidence fields
- Evidence snapshots
- Explainable score breakdown
- Evidence queue
- Evidence queue recovery
- Autonomous Top-500 re-ranking endpoint
- Property evidence dossier endpoint
- Visual evidence job queue
- System health endpoint
- Static audit tooling
- Roof/driveway/exterior/grounds evidence job categories

## Capabilities that can be incorporated immediately
These are architectural extensions that do not require changing the core ranking concept:
- Tree evidence category
- Tree image/crop jobs
- Power-line/utility evidence category
- Utility image/crop jobs
- Tree-to-line conflict evidence
- Tree-to-roof/structure/driveway proximity evidence
- Maintenance fusion
- Three-image historical comparison
- Ten-year deep-dive historical comparison
- Historical change evidence
- Hazard-specific confidence
- Hazard-specific score breakdown
- Property hazard dossier
- Automatic deep-dive triggers for high-value/high-priority/weak-evidence properties

## Evidence categories
The unified evidence model can carry:
PROPERTY
ROOF
DRIVEWAY
EXTERIOR
GROUNDS
TREES
POWER_LINES
UTILITIES
STORM
WEATHER
PERMITS
PROPERTY_VALUE
HISTORICAL_CHANGE

## Three-image default
Current + approximately -2 years + approximately -4 years.

## Ten-year deep dive
Current + approximately -2 + -4 + -6 + -8 + -10 years, using best available imagery near each target date.

## Automatic deep dive triggers
- Top-500 priority
- High property value
- Large score movement
- Conflicting evidence
- Low image confidence
- Potential tree/utility conflict
- Storm event association
- Significant historical change
- Incomplete evidence

## Important limitation
Actual detection quality depends on the image source, resolution, viewing angle, capture date, and image-processing model available to the deployment. The system must never fill missing visual evidence with invented facts.
