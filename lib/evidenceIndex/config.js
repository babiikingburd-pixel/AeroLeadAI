// lib/evidenceIndex/config.js
//
// COUNTY_MULTIPLIERS starts fully neutral (1.0 everywhere) on purpose.
// There's no real historical performance data for these six counties yet —
// AeroLeadAI's other JS intelligence layer already builds exactly this
// kind of learned weight (see lib/twincities/priorityEngine.js's
// COUNTY_MULTIPLIERS) from actual closed-deal outcomes. Once this pipeline
// accumulates its own closed-deal history, replace these 1.0s with real
// computed values the same way — never hand-tune a plausible-sounding
// number here. Ported from the evidence_index/ Python prototype's
// config.py, unchanged.

export const SUPPORTED_COUNTIES = ["hennepin", "ramsey", "dakota", "scott", "carver", "anoka"];

export const COUNTY_MULTIPLIERS = Object.fromEntries(SUPPORTED_COUNTIES.map((c) => [c, 1.0]));

// NWS/NOAA is free and keyless — https://www.weather.gov/documentation/services-web-api
export const NWS_API_BASE = "https://api.weather.gov";
export const NWS_USER_AGENT = "AeroLeadAI EvidenceIndex (contact: set-your-email-here@example.com)";
