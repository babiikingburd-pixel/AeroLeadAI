// lib/evidenceIndex/pipeline.js
//
// Wires together the six ported modules:
// countyEnricher -> stormOverlay -> evidenceEngine -> confidenceEngine ->
// opportunityEngine -> humanReview.
//
// Ported from evidence_index/ Python prototype's main.py (run_pipeline).
// A lead object fed into runPipeline() is expected to already carry
// whatever permit/property-value/imagery data those upstream sources
// provide — see app/api/evidence-index/route.js for how batch_leads rows
// are mapped into this shape.

import { enrichCounty } from "./enrichers/countyEnricher";
import { enrichStorm } from "./enrichers/stormOverlay";
import { evidenceScore } from "./engines/evidenceEngine";
import { confidenceScore } from "./engines/confidenceEngine";
import { opportunityScore } from "./engines/opportunityEngine";
import { requiresReview } from "./engines/humanReview";

export async function runPipeline(lead) {
  lead = enrichCounty(lead);
  lead = await enrichStorm(lead);

  const evidence = evidenceScore(lead);
  const confidence = confidenceScore(lead);
  const opportunity = opportunityScore(lead, lead.countyMultiplier ?? 1.0);
  const review = requiresReview(evidence, confidence, opportunity.normalized);

  return {
    address: lead.address ?? null,
    county: lead.countyNormalized ?? null,
    evidenceScore: evidence,
    confidenceScore: confidence,
    opportunityRawDollars: opportunity.rawDollars,
    opportunityNormalized: opportunity.normalized,
    reviewRequired: review.reviewRequired,
    reviewReasons: review.reasons,
  };
}
