# AeroLeadAI Oversight Search Operating Contract

Version: 1.0  
Initial territory: 55431 (Bloomington, Minnesota)  
First expansion: simultaneous southern front across Burnsville, Apple Valley, and Eagan  
System of record: `aeroleadai-rebuild`

## Purpose

Oversight discovers real residential properties, builds an evidence record for each parcel, and promotes only properties whose independent evidence clears the GateKeeper. Discovery is not a lead claim. Age, storms, permit absence, or imagery alone never proves roof damage.

## Search initiation

A search cycle may start only when all of the following are true:

1. A territory is explicitly authorized. The initial authorization is ZIP 55431.
2. The service-role database connection and `CRON_SECRET` are configured.
3. The territory has an active `ring_status` record.
4. The official parcel source is reachable.
5. The cycle has a bounded parcel, time, and paid-provider budget.

The autonomous worker resumes from retained parcels. It does not invent addresses, generate street numbers, or use demonstration records.

## Candidate eligibility

A parcel can enter the evidence queue only when the official county record supplies a parcel ID, street address, ZIP, latitude, longitude, active status, and residential classification. Condominiums, apartments, multi-address parcels, inactive parcels, and records without coordinates are rejected before scoring.

## Evidence order

Sources are queried from cheapest and most authoritative to costliest:

1. Hennepin County `LAND_PROPERTY`: parcel identity, residential class, year built, assessed value, and coordinates.
2. U.S. Census MAF/TIGER geocoder: independent address and ZIP match. A Census range match corroborates location but does not prove a structure exists.
3. Bloomington assessor/property search: individual city record confirmation when machine-readable access is available.
4. USPS Address Validation: deliverability and standardized mailing address only when USPS credentials are configured.
5. Permit registries: roof work chronology. A recent permit is counter-evidence; no permit is not proof of need.
6. NOAA storm records: dated hail/wind exposure.
7. Imagery: observable roof condition. Qualified imagery has the greatest scoring weight.

Every stored record includes provider, reality class, capture time, source reference, confidence, and payload. Unavailable sources are recorded as unavailable, never converted into positive signals.

## Scoring and promotion

- Year built is an age prior only.
- A roofing permit within 0–7 years is strong counter-evidence.
- A roofing permit within 8–15 years is mild counter-evidence.
- Storm evidence gains weight when it occurs after the most recent roofing permit.
- Imagery damage must include confidence and visibility/quality.
- Independent agreement increases confidence; contradictions force review.
- GateKeeper publication requires at least two real evidence types, confidence of at least 0.65, no unresolved contradictions, and opportunity of at least 35.
- Top 500 and Top 100 labels are assigned only by the evidence gate; discovery order alone cannot assign them.

## Autonomous cycle

Each daily cycle:

1. Fetches a bounded official parcel batch for the active territory.
2. Filters ineligible property classes.
3. Skips parcel IDs already retained.
4. Cross-checks a bounded subset through Census.
5. Stores evidence and recomputes the profile.
6. Updates ring completion and audit state.
7. Leaves failed sources queued for a later retry without deleting prior real evidence.

## Expansion

The current ring remains the priority. The next ring unlock percentage is one tenth of current-ring completion: `next_unlock_pct = current_completion_pct / 10`. The first unlocked frontier is intentionally biased south across the Minnesota River. Burnsville, Apple Valley, and Eagan receive equal per-cycle parcel quotas and equal worker targets; no city waits for another city to finish. Expansion never reduces the work assigned to completing the anchor ring and never permits duplicate territory allocation.

Dakota County's official `Residential Improved` layer is the identity and structure source for the three-city front. Only records whose dwelling type is exactly `S.FAM.RES` enter the queue. Townhouses and other attached or multifamily records are excluded before scoring.

## Truth and safety rules

- No fabricated addresses, signals, scores, images, permits, or source confirmations.
- No source is labeled USPS-confirmed unless the USPS response succeeded.
- No destructive overwrite of newer evidence by older evidence.
- No public browser-key write access.
- Paid providers remain disabled until credentials, pricing, and caps are confirmed.
- A property is an opportunity candidate, not a diagnosis, inspection result, insurance claim, or guarantee of roof damage.
