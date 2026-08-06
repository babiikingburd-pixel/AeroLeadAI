# AeroLeadAI APEX 9.0 → 9.6 Release Train

## 9.0 — Foundation
Android/Termux build path, Windows self-installer, build doctor, locked npm install, existing property intelligence, CRM, discovery, scanner and Twin Cities modules.

## 9.1 — Evidence Fusion
Canonical evidence confidence, freshness, completeness and agreement concepts. The release exposes explainable confidence rather than pretending missing data is certain.

## 9.2 — Validation Accelerator
Progressive validation: cheap filters first, expensive validation later. Use fingerprints, caching, batch priority and telemetry so the Twin Cities dataset can be processed without treating every property equally.

## 9.3 — Acquisition Network
Crawler/source registry, provenance, source health, retries and backoff. Bad sources can be isolated rather than poisoning every score.

## 9.4 — Safe Self-Improvement
Experiments run in a sandbox against a baseline. Candidate improvements require evaluation and an approval gate before production changes. No unrestricted self-editing.

## 9.5 — Conversion Intelligence
Opportunity score combines damage probability, property value, service fit, contactability, conversion probability, confidence and freshness. Actual CRM outcomes feed future evaluation.

## 9.6 — Mission Control
Unified release-health page at `/apex`, operational visibility, build/install controls, and a closed-loop architecture: Discover → Validate → Score → Prioritize → Contact → Outcome → Learn → Improve.

## Build gates
- `npm run doctor`
- `npm run verify`
- `npm run apex:status`
- `npm run build`
- Windows: `Install-AeroLeadAI.cmd -Start`
- Android/Termux: `bash android/setup-termux.sh` then `bash android/build-aeroleadai.sh`

## Runtime note
External API keys, Supabase credentials and third-party data providers remain environment-controlled. The application does not invent credentials or claim live external evidence when it is unavailable.
