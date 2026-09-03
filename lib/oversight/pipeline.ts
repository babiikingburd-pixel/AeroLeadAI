import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceProvider, ParcelContext } from "./contracts";
import { SupabaseEvidenceCache } from "./cache";

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
      // Temporary collection-only mode: GateKeeper evaluation, profile scoring,
      // and publication are deliberately bypassed while evidence acquisition is repaired.
      return { parcel, decision: null, evaluation: "BYPASSED" as const, evidence, providerFailures: settled.filter(r => r.status === "rejected").length };
    } finally { clearTimeout(timeout); }
  }
}
