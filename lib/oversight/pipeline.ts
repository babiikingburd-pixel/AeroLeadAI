import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceProvider, ParcelContext } from "./contracts";
import { SupabaseEvidenceCache } from "./cache";
import { evaluateEvidence } from "./gatekeeper";

export class OversightPipeline {
  private readonly cache: SupabaseEvidenceCache;
  constructor(private readonly db: SupabaseClient, private readonly providers: EvidenceProvider[]) { this.cache = new SupabaseEvidenceCache(db); }

  async run(parcel: ParcelContext) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.OVERSIGHT_PROVIDER_TIMEOUT_MS || 12000));
    try {
      const settled = await Promise.allSettled(this.providers.map(p => p.collect(parcel, controller.signal)));
      const fresh = settled.flatMap(result => result.status === "fulfilled" ? result.value : []);
      await this.cache.persist(fresh);
      const evidence = await this.cache.list(parcel.parcelId);
      const decision = evaluateEvidence(evidence);
      const profile = {
        parcel_id: parcel.parcelId, address: parcel.address, zip: parcel.zip || null, state: decision.state,
        gate_allowed: decision.allowed, gate_reasons: decision.reasons, opportunity: decision.opportunity,
        evidence_confidence: decision.evidenceConfidence, commercial_priority: decision.commercialPriority,
        contradictions: decision.contradictions, corroborations: decision.corroborations,
        completion_pct: decision.completionPct, deep_dive_tier: decision.deepDiveTier, updated_at: new Date().toISOString(),
      };
      const { error } = await this.db.from("roof_profiles").upsert(profile, { onConflict: "parcel_id" });
      if (error) throw new Error(`profile_write_failed: ${error.message}`);
      if (decision.allowed) {
        const { error: publishError } = await this.db.from("published_summary").upsert({
          parcel_id: parcel.parcelId, address: parcel.address, opportunity: decision.opportunity,
          evidence_confidence: decision.evidenceConfidence, commercial_priority: decision.commercialPriority,
          deep_dive_tier: decision.deepDiveTier, completion_pct: decision.completionPct, updated_at: new Date().toISOString(),
        }, { onConflict: "parcel_id" });
        if (publishError) throw new Error(`summary_write_failed: ${publishError.message}`);
      } else {
        await this.db.from("published_summary").delete().eq("parcel_id", parcel.parcelId);
      }
      return { parcel, decision, evidence, providerFailures: settled.filter(r => r.status === "rejected").length };
    } finally { clearTimeout(timeout); }
  }
}
