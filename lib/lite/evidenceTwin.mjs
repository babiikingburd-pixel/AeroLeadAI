import crypto from "node:crypto";

export const EVIDENCE_TWIN_VERSION = "AERO-LITE-EVIDENCE-TWIN-1.0";

const CURRENT_YEAR = new Date().getUTCFullYear();
const MN_BOUNDS = Object.freeze({ minLat: 43.4, maxLat: 49.4, minLon: -97.3, maxLon: -89.4 });
const TERMINAL = new Set(["verified", "none_found", "none-found", "unavailable", "reviewed", "graded", "adjudicated", "checked"]);
const BLOCKED_PROPERTY = /apartment|multifamily|multi-family|multi family|commercial|industrial|office|retail|hotel|school|church|condo building|duplex|triplex|fourplex|townhome complex/i;
const UNIT_ADDRESS = /\b(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/i;

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
};
const number = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || (typeof value === "string" && !value.trim())) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};
const text = (...values) => {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
};
const truthy = (value) => value === true || value === 1 || String(value).toLowerCase() === "true";

function compactEvidenceValue(value) {
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return { kind: "image", embedded: true };
    if (/^https?:\/\//i.test(value)) {
      try {
        const parsed = new URL(value);
        return { kind: "url", origin: parsed.origin, path: parsed.pathname };
      } catch {
        return { kind: "url" };
      }
    }
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(compactEvidenceValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/base64|dataurl|signedurl|token|secret|apikey/i.test(key))
        .slice(0, 40)
        .map(([key, child]) => [key, compactEvidenceValue(child)])
    );
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintEvidence(value) {
  return crypto.createHash("sha256").update(stableStringify(compactEvidenceValue(value))).digest("hex");
}

function observation(input) {
  const item = {
    claim: text(input.claim, "unknown"),
    source: text(input.source, "unknown"),
    sourceRef: text(input.sourceRef) || null,
    polarity: ["positive", "negative", "neutral"].includes(input.polarity) ? input.polarity : "neutral",
    verified: Boolean(input.verified),
    confidence: round(clamp(input.confidence, 0, 100)),
    observedAt: input.observedAt || null,
    reproducibleKey: text(input.reproducibleKey, input.claim, "unknown"),
    value: compactEvidenceValue(input.value),
  };
  return { ...item, fingerprint: fingerprintEvidence(item) };
}

function isTerminal(status) {
  return TERMINAL.has(text(status).toLowerCase());
}

function hasStormSignal(row) {
  const hail = number(row.hail_inches, row.hailInches) || 0;
  const wind = number(row.wind_mph, row.windMph) || 0;
  const body = stableStringify(compactEvidenceValue(row.storm_evidence || row.weather_evidence || {})).toLowerCase();
  return hail >= 0.75 || wind >= 55 || /hail|wind|tornado|derecho|severe|storm damage/.test(body);
}

function residentialSignal(row) {
  const propertyClass = text(row.property_class, row.propertyClass, row.property_use_type);
  const address = text(row.address);
  if (!address) return { eligible: false, confidence: 0, reason: "Address is missing." };
  if (BLOCKED_PROPERTY.test(`${propertyClass} ${address}`) || UNIT_ADDRESS.test(address)) {
    return { eligible: false, confidence: 95, reason: "Property appears multifamily, commercial, or unit-based." };
  }
  const stored = text(row.residential_status).toLowerCase();
  const storedConfidence = clamp(row.residential_confidence);
  const explicit = /single[\s-]?family|\bsfr\b|detached|one family|1 family|homestead|house|residential/.test(propertyClass.toLowerCase());
  return {
    eligible: true,
    confidence: Math.max(stored === "verified" ? 95 : stored === "probable" ? 75 : 0, storedConfidence, explicit ? 85 : 45),
    reason: explicit || stored === "verified" ? "Residential property signal present." : "Residential status still needs confirmation.",
  };
}

function minnesotaSignal(row) {
  const state = text(row.state, row.state_code).toUpperCase();
  if (state && !["MN", "MINNESOTA"].includes(state)) return { eligible: false, reason: `State is ${state}, not Minnesota.` };
  const lat = number(row.lat, row.latitude);
  const lon = number(row.lon, row.lng, row.longitude);
  if (lat !== null && lon !== null) {
    const inside = lat >= MN_BOUNDS.minLat && lat <= MN_BOUNDS.maxLat && lon >= MN_BOUNDS.minLon && lon <= MN_BOUNDS.maxLon;
    return { eligible: inside, reason: inside ? "Coordinates are inside Minnesota bounds." : "Coordinates are outside Minnesota bounds." };
  }
  const zip = text(row.zip, row.zip_code, row.postal_code);
  if (/^(55|56)\d{3}$/.test(zip)) return { eligible: true, reason: "Minnesota ZIP code present." };
  // Unknown geography is not enough for a statewide roofing list. It may be
  // enriched later, but cannot enter the Minnesota Top 500 yet.
  return { eligible: false, reason: state ? "Minnesota state code present." : "Minnesota geography is not verified." };
}

function imageRows(row, images) {
  const supplied = Array.isArray(images) ? images : [];
  const embedded = Array.isArray(row.images) ? row.images : [];
  return [...supplied, ...embedded].filter(Boolean);
}

export function buildEvidenceLedger(row = {}, images = [], findings = []) {
  const items = [];
  const residential = residentialSignal(row);
  const address = text(row.address);
  const lat = number(row.lat, row.latitude);
  const lon = number(row.lon, row.lng, row.longitude);
  const parcel = text(row.parcel_id, row.property_id, row.id);

  if (address || (lat !== null && lon !== null)) {
    items.push(observation({
      claim: "property_identity",
      source: "property-record",
      polarity: "positive",
      verified: Boolean(address && lat !== null && lon !== null),
      confidence: address && lat !== null && lon !== null ? 95 : 65,
      observedAt: row.updated_at || row.created_at || null,
      value: { address, lat, lon, parcel },
    }));
  }

  items.push(observation({
    claim: "residential_eligibility",
    source: "property-classification",
    polarity: residential.eligible ? "positive" : "negative",
    verified: residential.confidence >= 80,
    confidence: residential.confidence,
    observedAt: row.assessor_checked_at || row.updated_at || null,
    value: { propertyClass: text(row.property_class, row.propertyClass), status: row.residential_status || null },
  }));

  const yearBuilt = number(row.year_built, row.yearBuilt);
  const assessedValue = number(row.assessed_value, row.assessedValue);
  if (yearBuilt !== null || assessedValue !== null) {
    items.push(observation({
      claim: "assessor_record",
      source: "assessor",
      polarity: "positive",
      verified: isTerminal(row.value_evidence_status) || Boolean(row.assessor_checked_at),
      confidence: isTerminal(row.value_evidence_status) ? 95 : 75,
      observedAt: row.assessor_checked_at || row.value_checked_at || row.updated_at || null,
      value: { yearBuilt, assessedValue },
    }));
  }

  const permitStatus = text(row.permit_evidence_status).toLowerCase();
  const permitChecked = isTerminal(permitStatus) || Boolean(row.permit_checked_at || row.permit_notes);
  const recentPermit = row.permit_within_10y === true;
  if (permitChecked) {
    items.push(observation({
      claim: "recent_roof_permit",
      source: "permit-records",
      polarity: recentPermit ? "positive" : "negative",
      verified: isTerminal(permitStatus) || Boolean(row.permit_checked_at),
      confidence: isTerminal(permitStatus) ? 95 : 75,
      observedAt: row.permit_checked_at || row.updated_at || null,
      value: { status: permitStatus || "checked", recentPermit, count: number(row.permit_history_count) },
    }));
  }

  const stormChecked = isTerminal(row.storm_evidence_status) || isTerminal(row.weather_evidence_status) || Boolean(row.storm_checked_at || row.weather_checked_at || row.storm_date);
  if (stormChecked) {
    const stormSignal = hasStormSignal(row);
    items.push(observation({
      claim: "storm_exposure",
      source: "storm-records",
      polarity: stormSignal ? "positive" : "negative",
      verified: true,
      confidence: 90,
      observedAt: row.storm_checked_at || row.weather_checked_at || row.storm_date || null,
      value: { hailInches: number(row.hail_inches, row.hailInches), windMph: number(row.wind_mph, row.windMph), stormDate: row.storm_date || null },
    }));
  }

  const allImages = imageRows(row, images);
  for (const image of allImages.slice(0, 20)) {
    const storagePath = text(image.storage_path, image.path);
    const provider = text(image.provider, image.source, "imagery");
    const available = Boolean(storagePath || image.image_url || image.enhanced_image_url || image.original_image_url || image.dataUrl);
    if (!available) continue;
    items.push(observation({
      claim: "imagery_available",
      source: `imagery:${provider}`,
      sourceRef: storagePath || null,
      polarity: "positive",
      verified: Boolean(storagePath || image.evidence_status === "verified" || image.evidence_status === "fetched"),
      confidence: number(image.quality_score, image.confidence, 75),
      observedAt: image.capture_date || image.fetched_at || image.created_at || row.image_fetched_at || null,
      reproducibleKey: `imagery:${text(image.view, image.image_kind, "property")}`,
      value: { storagePath: storagePath || null, provider, view: text(image.view, image.image_kind) || null, contentHash: image.content_hash || null },
    }));
  }

  const visualScore = number(row.image_damage_score, row.roof_visual_score, row.visual_damage_score);
  const visualReviewed = ["verified", "graded", "adjudicated", "approved", "reviewed"].includes(text(row.image_review_status).toLowerCase());
  if (visualScore !== null) {
    items.push(observation({
      claim: "roof_concern",
      source: "visual-analysis",
      polarity: visualScore >= 40 ? "positive" : visualScore <= 25 ? "negative" : "neutral",
      verified: visualReviewed,
      confidence: number(row.image_review_confidence, row.validation_confidence, visualReviewed ? 80 : 45),
      observedAt: row.image_reviewed_at || row.image_fetched_at || row.updated_at || null,
      value: { score: clamp(visualScore), visibility: number(row.image_visibility_score), reviewed: visualReviewed },
    }));
  }

  for (const finding of (Array.isArray(findings) ? findings : []).slice(0, 100)) {
    const evidence = finding.evidence && typeof finding.evidence === "object" ? finding.evidence : {};
    const status = text(finding.verification_status, evidence.verification_status).toLowerCase();
    const rawPolarity = text(finding.polarity, evidence.polarity).toLowerCase();
    const polarity = ["positive", "negative", "neutral"].includes(rawPolarity)
      ? rawPolarity
      : ["disproved", "rejected", "contradicted"].includes(status) ? "negative" : "positive";
    items.push(observation({
      claim: text(finding.claim, evidence.claim, `${finding.lane_name || "crawler"}_finding`),
      source: text(finding.source, finding.lane_name, "crawler"),
      sourceRef: text(finding.source_ref) || null,
      polarity,
      verified: ["verified", "adjudicated", "disproved", "contradicted"].includes(status),
      confidence: number(finding.confidence, evidence.confidence, 50),
      observedAt: finding.observed_at || finding.created_at || null,
      reproducibleKey: text(evidence.reproducible_key, finding.claim, finding.lane_name, "crawler"),
      value: evidence,
    }));
  }

  const unique = new Map();
  for (const item of items) unique.set(item.fingerprint, item);
  const evidence = [...unique.values()];
  const verified = evidence.filter((item) => item.verified);
  const grouped = new Map();
  for (const item of verified) {
    if (!grouped.has(item.claim)) grouped.set(item.claim, new Set());
    if (item.polarity !== "neutral") grouped.get(item.claim).add(item.polarity);
  }
  const contradictions = [...grouped.entries()]
    .filter(([, polarities]) => polarities.has("positive") && polarities.has("negative"))
    .map(([claim]) => claim);
  const independentSources = new Set(verified.map((item) => item.source)).size;
  const repeatGroups = new Map();
  for (const item of verified.filter((entry) => entry.polarity === "positive")) {
    if (!repeatGroups.has(item.reproducibleKey)) repeatGroups.set(item.reproducibleKey, new Set());
    repeatGroups.get(item.reproducibleKey).add(item.source);
  }
  const repeatedSuccesses = [...repeatGroups.values()].filter((sources) => sources.size >= 2).length;
  return { evidence, verified, contradictions, independentSources, repeatedSuccesses };
}

function newestEvidenceAgeDays(ledger, row) {
  const dates = [row.scored_at, row.evidence_cycle_at, row.updated_at, ...ledger.evidence.map((item) => item.observedAt)]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  if (!dates.length) return null;
  return Math.max(0, (Date.now() - Math.max(...dates)) / 86400000);
}

function component(score, max, reasons = []) {
  return { score: round(clamp(score, 0, max)), max, reasons: reasons.filter(Boolean) };
}

function scoreOpportunity(row, ledger) {
  const yearBuilt = number(row.year_built, row.yearBuilt);
  const propertyAge = yearBuilt === null ? null : Math.max(0, CURRENT_YEAR - yearBuilt);
  const agePoints = propertyAge === null ? 5 : propertyAge >= 30 ? 18 : propertyAge >= 25 ? 16 : propertyAge >= 20 ? 14 : propertyAge >= 15 ? 10 : propertyAge >= 10 ? 5 : 1;
  const permitGap = row.permit_within_10y === false || ["none_found", "none-found"].includes(text(row.permit_evidence_status).toLowerCase()) ? 7 : row.permit_within_10y === true ? 0 : 3;
  const roofAge = component(agePoints + permitGap, 25, [
    propertyAge === null ? "Roof/property age needs verification." : `Property age signal: ${propertyAge} years.`,
    permitGap >= 7 ? "No recent permit found." : row.permit_within_10y === true ? "Recent permit lowers replacement urgency." : "Permit gap is not resolved.",
  ]);

  const visualRaw = clamp(number(row.image_damage_score, row.roof_visual_score, row.visual_damage_score) || 0);
  const visualReviewed = ["verified", "graded", "adjudicated", "approved", "reviewed"].includes(text(row.image_review_status).toLowerCase());
  const visual = component(visualRaw * (visualReviewed ? 0.25 : 0.14), 25, [
    visualRaw ? `Visual concern signal: ${round(visualRaw)}.` : "No visual concern score yet.",
    visualReviewed ? "Imagery has been reviewed." : "Unreviewed imagery is intentionally capped.",
  ]);

  const hail = number(row.hail_inches, row.hailInches) || 0;
  const wind = number(row.wind_mph, row.windMph) || 0;
  const stormSignal = hasStormSignal(row);
  const storm = component(Math.min(10, hail * 5.5) + Math.min(5, Math.max(0, wind - 40) / 8) + (stormSignal && hail === 0 && wind === 0 ? 5 : 0), 15, [
    hail ? `${hail}\" hail evidence.` : null,
    wind ? `${wind} mph wind evidence.` : null,
    stormSignal && !hail && !wind ? "Storm evidence is present." : null,
  ]);

  const tree = clamp(number(row.tree_score) || 0);
  const driveway = clamp(number(row.driveway_score) || 0);
  const damageNotes = row.damage_notes && typeof row.damage_notes === "object" ? row.damage_notes : {};
  const hazards = component(
    tree * 0.05 + driveway * 0.02 + (truthy(damageNotes.heavySnowRegion) ? 1 : 0) + (truthy(damageNotes.heavyRainRegion) ? 1 : 0) + (truthy(damageNotes.gutterIndicator) ? 1 : 0),
    10,
    [tree >= 50 ? "Tree-overhang or fall risk signal." : null, driveway >= 50 ? "Driveway/exterior deterioration signal." : null]
  );

  const assessed = number(row.assessed_value, row.assessedValue) || 0;
  const replacement = number(row.replacement_cost, row.roof_estimate_usd, row.roofEstimateUsd) || 0;
  const economics = component(Math.max(Math.min(10, assessed / 75000), Math.min(10, replacement / 4000)), 10, [
    replacement ? `Estimated roof work value: $${Math.round(replacement).toLocaleString("en-US")}.` : assessed ? `Assessed value: $${Math.round(assessed).toLocaleString("en-US")}.` : "Job economics need enrichment.",
  ]);

  const predictedNeed = clamp(number(row.necessity_score, row.opportunity_prediction?.score, row.maintenance_prediction?.score) || 0);
  const maintenance = component(Math.max(predictedNeed * 0.1, ((agePoints / 18) * 6) + ((permitGap / 7) * 4)), 10, [
    predictedNeed ? `Predictive maintenance signal: ${round(predictedNeed)}.` : "Maintenance need inferred from age and permit gap.",
  ]);

  const urgencyRaw = clamp(number(row.urgency_score, row.safety_prediction?.score, row.validation_priority, row.validation_score) || 0);
  const urgency = component(urgencyRaw * 0.05, 5, [urgencyRaw ? `Urgency/safety signal: ${round(urgencyRaw)}.` : "No immediate safety escalation recorded."]);

  const components = { roofAgePermitGap: roofAge, visualCondition: visual, stormExposure: storm, hazards, economics, maintenanceNeed: maintenance, urgency };
  const score = round(Object.values(components).reduce((sum, entry) => sum + entry.score, 0));
  return { score, propertyAge, components };
}

function scoreConfidence(row, ledger, images) {
  const address = text(row.address);
  const lat = number(row.lat, row.latitude);
  const lon = number(row.lon, row.lng, row.longitude);
  const parcel = text(row.parcel_id, row.property_id, row.id);
  const identity = component((address ? 6 : 0) + (lat !== null && lon !== null ? 5 : 0) + (parcel ? 4 : 0), 15, [address ? "Address present." : "Address missing.", lat !== null && lon !== null ? "Coordinates present." : "Coordinates missing.", parcel ? "Parcel/property identifier present." : "Parcel identifier missing."]);

  const residential = residentialSignal(row);
  const residentialEvidence = component(residential.eligible ? 8 + (residential.confidence / 100) * 7 : 0, 15, [residential.reason]);

  const allImages = imageRows(row, images);
  const hasImage = allImages.some((image) => image.storage_path || image.image_url || image.enhanced_image_url || image.original_image_url || image.dataUrl) || Boolean(row.image_fetched_at);
  const reviewed = ["verified", "graded", "adjudicated", "approved", "reviewed"].includes(text(row.image_review_status).toLowerCase());
  const imageQuality = clamp(number(row.image_review_confidence, row.image_visibility_score, ...allImages.map((image) => image.quality_score)) || 0);
  const imagery = component((hasImage ? 6 : 0) + (reviewed ? 8 : 0) + (imageQuality / 100) * 6, 20, [hasImage ? "Imagery available." : "Imagery missing.", reviewed ? "Imagery reviewed." : "Imagery review missing."]);

  const permitStatus = text(row.permit_evidence_status).toLowerCase();
  const permitChecked = isTerminal(permitStatus) || Boolean(row.permit_checked_at || row.permit_notes);
  const permit = component((permitChecked ? 10 : 0) + (isTerminal(permitStatus) ? 5 : 0), 15, [permitChecked ? "Permit search completed." : "Permit search missing."]);

  const stormChecked = isTerminal(row.storm_evidence_status) || isTerminal(row.weather_evidence_status) || Boolean(row.storm_checked_at || row.weather_checked_at || row.storm_date);
  const storm = component((stormChecked ? 6 : 0) + (hasStormSignal(row) || row.storm_date ? 4 : 0), 10, [stormChecked ? "Storm source checked." : "Storm source missing."]);

  const yearBuilt = number(row.year_built, row.yearBuilt);
  const assessed = number(row.assessed_value, row.assessedValue);
  const assessor = component((yearBuilt !== null ? 5 : 0) + (assessed !== null ? 5 : 0), 10, [yearBuilt !== null ? "Year built present." : "Year built missing.", assessed !== null ? "Assessed value present." : "Assessed value missing."]);

  const corroboration = component(Math.min(10, ledger.independentSources * 2 + ledger.repeatedSuccesses * 2), 10, [`${ledger.independentSources} independent source(s); ${ledger.repeatedSuccesses} repeated success group(s).`]);
  const ageDays = newestEvidenceAgeDays(ledger, row);
  const freshnessPoints = ageDays === null ? 0 : ageDays <= 7 ? 5 : ageDays <= 30 ? 4 : ageDays <= 90 ? 2 : 0;
  const freshness = component(freshnessPoints, 5, [ageDays === null ? "Evidence freshness unknown." : `Newest evidence is ${Math.round(ageDays)} day(s) old.`]);

  const components = { identity, residential: residentialEvidence, imagery, permit, storm, assessor, corroboration, freshness };
  const score = round(Object.values(components).reduce((sum, entry) => sum + entry.score, 0));
  return { score, ageDays: ageDays === null ? null : round(ageDays), components };
}

function contractorTerritoryMatch(row, contractor) {
  if (!contractor) return null;
  const city = text(row.city).toLowerCase();
  const county = text(row.county).toLowerCase();
  const cities = (contractor.service_area_cities || contractor.cities || []).map((value) => text(value).toLowerCase());
  const counties = (contractor.service_area_counties || contractor.counties || []).map((value) => text(value).toLowerCase());
  if (!cities.length && !counties.length) return null;
  return cities.includes(city) || counties.includes(county);
}

function scoreContractorValue(row, opportunity, confidence, contractor) {
  const territoryMatch = contractorTerritoryMatch(row, contractor);
  const territory = component(territoryMatch === true ? 25 : territoryMatch === false ? 0 : 15, 25, [territoryMatch === true ? "Inside contractor territory." : territoryMatch === false ? "Outside contractor territory." : "Generic Minnesota territory value."]);
  const assessed = number(row.assessed_value, row.assessedValue) || 0;
  const replacement = number(row.replacement_cost, row.roof_estimate_usd, row.roofEstimateUsd) || 0;
  const jobValue = component(Math.max(Math.min(20, replacement / 2000), Math.min(20, assessed / 37500)), 20, [replacement || assessed ? "Job/property economics available." : "Job value needs enrichment."]);
  const residential = residentialSignal(row);
  const roofingFit = component((residential.eligible ? 8 : 0) + Math.min(7, (opportunity.components.roofAgePermitGap.score + opportunity.components.visualCondition.score) / 7), 15, [residential.eligible ? "Residential roofing fit." : "Not a roofing-fit property."]);
  const contactable = Boolean(row.owner_phone || row.owner_email || row.phone || row.email || row.contactable);
  const actionable = component((text(row.address) ? 5 : 0) + (number(row.lat, row.latitude) !== null && number(row.lon, row.lng, row.longitude) !== null ? 5 : 0) + (contactable ? 5 : 0), 15, [contactable ? "Contact channel present." : "Contact channel not verified."]);
  const deliveryReadiness = component(confidence.score * 0.1, 10, [`Evidence confidence contributes ${round(confidence.score * 0.1)} points.`]);
  const clusterSignal = clamp(number(row.development_signal, row.cluster_score, row.neighborhood_opportunity_score) || 0);
  const clustering = component(clusterSignal * 0.1, 10, [clusterSignal ? "Neighborhood/cluster opportunity present." : "No cluster evidence yet."]);
  const lockedTo = text(row.territory_locked_to, row.contractor_id);
  const contractorId = text(contractor?.id, contractor?.contractor_id);
  const exclusive = component(!lockedTo ? 3 : contractorId && lockedTo === contractorId ? 5 : 0, 5, [!lockedTo ? "Territory is available for exclusive assignment." : contractorId && lockedTo === contractorId ? "Exclusive territory match." : "Territory is assigned elsewhere."]);
  const components = { territory, jobValue, roofingFit, actionable, deliveryReadiness, clustering, exclusivity: exclusive };
  const score = round(Object.values(components).reduce((sum, entry) => sum + entry.score, 0));
  return { score, territoryMatch, components };
}

function classificationFor({ opportunity, confidence, ledger, infrastructureGaps }) {
  if (ledger.contradictions.length) return "CONTRADICTED";
  if (infrastructureGaps.length) return "INFRASTRUCTURE-GAP";
  if (opportunity >= 70 && confidence >= 85 && ledger.independentSources >= 3 && ledger.repeatedSuccesses >= 1) return "VERIFIED-ACTIONABLE";
  if (opportunity >= 55 && confidence >= 70 && ledger.independentSources >= 2) return "VERIFIED-WITH-CAUTION";
  if (opportunity >= 50) return "PARTIAL";
  return "HOLD-FOR-VERIFICATION";
}

function planEvidenceWork({ row, confidence, ledger, globalRank }) {
  const gaps = [];
  const add = (lane, expectedInformationGain, estimatedCost, objective, risk = "low") => {
    const contradictionBoost = ledger.contradictions.some((claim) => claim.includes(lane) || (lane === "damage" && claim === "roof_concern")) ? 30 : 0;
    const rankBoost = globalRank && globalRank <= 20 ? 50 : globalRank && globalRank <= 100 ? 30 : globalRank && globalRank <= 500 ? 10 : 0;
    const gain = expectedInformationGain + contradictionBoost;
    gaps.push({ lane, objective, expectedInformationGain: round(gain), estimatedCost, informationValue: round(gain / Math.max(estimatedCost, 0.1), 3), risk, priority: Math.round(gain + rankBoost) });
  };
  if (confidence.components.residential.score < confidence.components.residential.max) add("residential", confidence.components.residential.max - confidence.components.residential.score, 1, "Prove single-family residential eligibility and disprove apartment/commercial classifications.");
  if (confidence.components.permit.score < confidence.components.permit.max) add("permits", confidence.components.permit.max - confidence.components.permit.score, 1.4, "Search roof/building permit history and record a verified result, including none found.");
  if (confidence.components.storm.score < confidence.components.storm.max) add("storm", confidence.components.storm.max - confidence.components.storm.score, 1.1, "Refresh hail, wind and severe-weather evidence for the exact property.");
  if (confidence.components.imagery.score < 6) add("imagery", 20, 1.8, "Acquire current overhead imagery through the provider fallback chain and store only object metadata.", "medium");
  else if (confidence.components.imagery.score < confidence.components.imagery.max) add("damage", confidence.components.imagery.max - confidence.components.imagery.score + 10, 2.4, "Review multiple roof views for damage and record a reproducible visual finding.", "medium");
  if (confidence.components.assessor.score < confidence.components.assessor.max) add("development", confidence.components.assessor.max - confidence.components.assessor.score + 4, 1.5, "Resolve assessor, year-built, parcel and neighborhood-development evidence.");
  add("competition", 5, 0.5, "Compare this property with the current slot cutoff and promote or challenge it using the versioned score.");
  if (ledger.contradictions.length) add("contradiction", 35, 1.2, `Resolve conflicting claims: ${ledger.contradictions.join(", ")}.`, "medium");
  return gaps.sort((a, b) => b.informationValue - a.informationValue || b.priority - a.priority);
}

export function scoreEvidenceTwin(row = {}, options = {}) {
  const images = options.images || [];
  const findings = options.findings || [];
  const ledger = buildEvidenceLedger(row, images, findings);
  const minnesota = minnesotaSignal(row);
  const residential = residentialSignal(row);
  const exclusionReasons = [!minnesota.eligible ? minnesota.reason : null, !residential.eligible ? residential.reason : null, text(row.review_status).toLowerCase() === "rejected" ? "Human review rejected this property." : null].filter(Boolean);
  const eligible = exclusionReasons.length === 0;
  const opportunity = scoreOpportunity(row, ledger);
  const confidence = scoreConfidence(row, ledger, images);
  const contractorValue = scoreContractorValue(row, opportunity, confidence, options.contractor || null);

  const penalties = [];
  if (row.permit_within_10y === true) penalties.push({ reason: "Recent roof/building permit", points: 18 });
  if (ledger.contradictions.length) penalties.push({ reason: `${ledger.contradictions.length} unresolved contradiction(s)`, points: Math.min(36, ledger.contradictions.length * 12) });
  if (confidence.ageDays !== null && confidence.ageDays > 90) penalties.push({ reason: "Evidence older than 90 days", points: 8 });
  if (!eligible) penalties.push({ reason: exclusionReasons.join(" "), points: 100 });
  const penaltyPoints = penalties.reduce((sum, item) => sum + item.points, 0);
  const rankScore = eligible ? round(clamp(opportunity.score * 0.60 + confidence.score * 0.25 + contractorValue.score * 0.15 - penaltyPoints)) : 0;
  const infrastructureGaps = (options.infrastructureGaps || []).filter(Boolean);
  const classification = eligible ? classificationFor({ opportunity: opportunity.score, confidence: confidence.score, ledger, infrastructureGaps }) : "EXCLUDED";
  const certified = eligible && !ledger.contradictions.length && confidence.score >= 80 && ledger.independentSources >= 3 && confidence.components.imagery.score >= 14 && confidence.components.permit.score >= 10;
  const globalRank = number(options.globalRank);
  const evidencePlan = planEvidenceWork({ row, confidence, ledger, globalRank });

  return {
    version: EVIDENCE_TWIN_VERSION,
    propertyId: text(row.id, row.property_id) || null,
    eligible,
    eligibility: { minnesota, residential, exclusionReasons },
    opportunityScore: opportunity.score,
    evidenceConfidence: confidence.score,
    contractorValueScore: contractorValue.score,
    rankScore,
    scoreStatus: certified ? "CERTIFIED" : "PROVISIONAL",
    classification,
    penalties,
    breakdown: { opportunity: opportunity.components, confidence: confidence.components, contractorValue: contractorValue.components },
    propertyAge: opportunity.propertyAge,
    evidenceAgeDays: confidence.ageDays,
    evidenceSummary: {
      count: ledger.evidence.length,
      verifiedCount: ledger.verified.length,
      independentSources: ledger.independentSources,
      repeatedSuccesses: ledger.repeatedSuccesses,
      contradictions: ledger.contradictions,
      fingerprints: ledger.evidence.map((item) => item.fingerprint),
    },
    evidence: ledger.evidence,
    evidencePlan,
  };
}

function tierForRank(rank, twin) {
  if (rank <= 20) return twin.scoreStatus === "CERTIFIED" ? "TOP20" : "TOP20-CANDIDATE";
  if (rank <= 100) return "TOP100";
  if (rank <= 500) return "TOP500";
  return "MINNESOTA_INDEX";
}

export function rankEvidenceTwins(rows = [], options = {}) {
  const scored = rows.map((entry) => {
    const row = entry?.row || entry;
    const id = text(row?.id, row?.property_id);
    return { row, twin: scoreEvidenceTwin(row, { ...options, images: options.imagesById?.[id] || entry?.images || [], findings: options.findingsById?.[id] || entry?.findings || [] }) };
  });
  const eligible = scored.filter((item) => item.twin.eligible);
  const certifiedTop = eligible
    .filter((item) => item.twin.scoreStatus === "CERTIFIED")
    .sort((a, b) => b.twin.rankScore - a.twin.rankScore || b.twin.evidenceConfidence - a.twin.evidenceConfidence)
    .slice(0, 20);
  const certifiedIds = new Set(certifiedTop.map((item) => item.twin.propertyId));
  const proven = eligible
    .filter((item) => !certifiedIds.has(item.twin.propertyId) && item.twin.evidenceConfidence >= 65)
    .sort((a, b) => b.twin.rankScore - a.twin.rankScore || b.twin.evidenceConfidence - a.twin.evidenceConfidence);
  const provenTop = [...certifiedTop, ...proven.slice(0, Math.max(0, 80 - certifiedTop.length))];
  const used = new Set(provenTop.map((item) => item.twin.propertyId));
  const challengers = eligible
    .filter((item) => !used.has(item.twin.propertyId))
    .sort((a, b) => b.twin.opportunityScore - a.twin.opportunityScore || b.twin.rankScore - a.twin.rankScore)
    .slice(0, Math.max(0, 100 - provenTop.length));
  // Keep certified profiles first. A high-opportunity challenger can enter the
  // Top 100, but it cannot displace a fully proven contractor-ready Top 20.
  const top100 = [
    ...certifiedTop.map((item) => ({ ...item, selectionTrack: "CERTIFIED" })),
    ...provenTop.filter((item) => !certifiedIds.has(item.twin.propertyId)).map((item) => ({ ...item, selectionTrack: "PROVEN" })),
    ...challengers.map((item) => ({ ...item, selectionTrack: "CHALLENGER" })),
  ];
  const topIds = new Set(top100.map((item) => item.twin.propertyId));
  const remainder = eligible
    .filter((item) => !topIds.has(item.twin.propertyId))
    .sort((a, b) => b.twin.rankScore - a.twin.rankScore || b.twin.opportunityScore - a.twin.opportunityScore);
  const ordered = [...top100, ...remainder];
  return ordered.map((item, index) => {
    const globalRank = index + 1;
    const twin = scoreEvidenceTwin(item.row, {
      ...options,
      globalRank,
      images: options.imagesById?.[item.twin.propertyId] || item.images || [],
      findings: options.findingsById?.[item.twin.propertyId] || item.findings || [],
    });
    return { ...item.row, evidenceTwin: twin, liteRank: globalRank, liteTier: tierForRank(globalRank, twin), selectionTrack: item.selectionTrack || "RANKED" };
  });
}
