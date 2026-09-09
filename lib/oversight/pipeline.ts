import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceProvider, EvidenceRecord, ParcelContext } from "./contracts";
import { SupabaseEvidenceCache } from "./cache";

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "unknown_error");
  return message.slice(0, 300);
}

async function collectWithTimeout(
  provider: EvidenceProvider,
  parcel: ParcelContext,
  timeoutMs: number,
): Promise<EvidenceRecord[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<EvidenceRecord[]>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${provider.name}_timeout_after_${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([provider.collect(parcel, controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class OversightPipeline {
  private readonly cache: SupabaseEvidenceCache;

  constructor(private readonly db: SupabaseClient, private readonly providers: EvidenceProvider[]) {
    this.cache = new SupabaseEvidenceCache(db);
  }

  async run(parcel: ParcelContext) {
    const configuredTimeout = Number(process.env.OVERSIGHT_PROVIDER_TIMEOUT_MS || 12000);
    const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1000, configuredTimeout) : 12000;

    const settled = await Promise.allSettled(
      this.providers.map(async provider => ({
        provider: provider.name,
        type: provider.type,
        records: await collectWithTimeout(provider, parcel, timeoutMs),
      })),
    );

    const fresh = settled.flatMap(result => result.status === "fulfilled" ? result.value.records : []);
    const providerErrors = settled.flatMap((result, index) => {
      if (result.status === "fulfilled") return [];
      const provider = this.providers[index];
      return [{
        provider: provider?.name || `provider_${index}`,
        type: provider?.type || "UNKNOWN",
        error: errorMessage(result.reason),
      }];
    });

    const cacheWarnings: string[] = [];

    // Cache persistence is useful, but must never erase the value of evidence
    // that was successfully collected during this run.
    try {
      await this.cache.persist(fresh);
    } catch (error) {
      cacheWarnings.push(errorMessage(error));
    }

    let cached: EvidenceRecord[] = [];
    try {
      cached = await this.cache.list(parcel.parcelId);
    } catch (error) {
      cacheWarnings.push(errorMessage(error));
    }

    // Always return fresh evidence, even when Supabase is temporarily unable
    // to persist or read the cache. Cached records are merged when available.
    const byId = new Map<string, EvidenceRecord>();
    for (const record of cached) byId.set(record.id, record);
    for (const record of fresh) byId.set(record.id, record);
    const evidence = [...byId.values()].sort((left, right) =>
      String(right.capturedAt || "").localeCompare(String(left.capturedAt || ""))
    );

    // Temporary collection-only mode: GateKeeper evaluation, profile scoring,
    // and publication are deliberately bypassed while evidence acquisition is repaired.
    return {
      parcel,
      decision: null,
      evaluation: "BYPASSED" as const,
      evidence,
      providerFailures: providerErrors.length,
      providerErrors,
      cacheWarnings,
      degraded: providerErrors.length > 0 || cacheWarnings.length > 0,
    };
  }
}
