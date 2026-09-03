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

const ENGINE_PROVIDER: Record<string, string | null> = {
  identity_resolver: "usps_addresses_v3",
  property_assessor: "assessor",
  permit_registry: "permit_registry",
  weather: "noaa_storm_events",
  imagery_acquisition: null,
  imagery_analysis: "imagery_analysis",
};

export function createEvidenceProvidersForEngine(engine: string): EvidenceProvider[] {
  const providerName = ENGINE_PROVIDER[engine];
  if (!providerName) return [];
  return createEvidenceProviders().filter(provider => provider.name === providerName);
}

const REQUIREMENT_ENGINE: Record<string, string> = {
  identity: "identity_resolver",
  geolocation: "property_assessor",
  property_classification: "property_assessor",
  year_built: "property_assessor",
  imagery_capture: "imagery_acquisition",
  imagery_date: "imagery_analysis",
  imagery_analysis: "imagery_analysis",
  permit_history: "permit_registry",
  weather_history: "weather",
};

export function createEvidenceProvidersForRequirement(requirement: string): EvidenceProvider[] {
  return createEvidenceProvidersForEngine(REQUIREMENT_ENGINE[requirement] || "");
}

export function crawlerGroupEngines(group: CrawlerGroup) {
  return group === "A"
    ? ["identity_resolver", "property_assessor", "permit_registry"]
    : ["weather", "imagery_acquisition", "imagery_analysis"];
}
