import type { EvidenceProvider } from "./contracts";
import { createEvidenceProviders } from "./providers";

export type CrawlerGroup = "A" | "B";

const GROUP_PROVIDERS: Record<CrawlerGroup, Set<string>> = {
  A: new Set(["usps_addresses_v3", "assessor", "permit_registry"]),
  B: new Set(["noaa_storm_events", "imagery_analysis"]),
};

export function createEvidenceProvidersForGroup(group: CrawlerGroup): EvidenceProvider[] {
  const allowed = GROUP_PROVIDERS[group];
  return createEvidenceProviders().filter(provider => allowed.has(provider.name));
}

export function crawlerGroupEngines(group: CrawlerGroup) {
  return group === "A"
    ? ["identity_resolver", "property_assessor", "permit_registry"]
    : ["weather", "imagery_acquisition", "imagery_analysis"];
}
