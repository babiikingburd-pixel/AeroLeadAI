// lib/twincities/normalizeAddress.js
//
// address_normalized (a generated column on batch_leads) already strips
// punctuation and lowercases, but does NOT expand abbreviations — "123 Main
// St" and "123 Main Street" normalize to different strings today. This
// utility closes that gap for the cases where matching genuinely has to
// happen on address text (e.g. an assessor data source keyed by address,
// not parcel geometry).
//
// Point-based matching (lat/lon -> ArcGIS identify, see propertyValue.js)
// is preferred wherever a county's parcel layer supports it, since it
// sidesteps address-format drift entirely. This is the fallback for
// sources that only expose an address-keyed lookup.

const STREET_SUFFIXES = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave",
  boulevard: "blvd", blvd: "blvd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  road: "rd", rd: "rd",
  court: "ct", ct: "ct",
  circle: "cir", cir: "cir",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter",
  parkway: "pkwy", pkwy: "pkwy",
  trail: "trl", trl: "trl",
  way: "way",
  highway: "hwy", hwy: "hwy",
};

const DIRECTIONALS = {
  north: "n", n: "n",
  south: "s", s: "s",
  east: "e", e: "e",
  west: "w", w: "w",
  northeast: "ne", ne: "ne",
  northwest: "nw", nw: "nw",
  southeast: "se", se: "se",
  southwest: "sw", sw: "sw",
};

/**
 * @param {string} address
 * @returns {string} normalized, abbreviation-expanded-to-short-form address,
 *   lowercase, single-spaced. Not the same output as batch_leads'
 *   address_normalized column (that one strips ALL punctuation/spaces) —
 *   this keeps spaces so it's readable for debugging and diffing, and is
 *   meant for matching against other address-keyed sources, not for direct
 *   SQL joins against address_normalized.
 */
export function normalizeAddress(address) {
  if (!address) return "";

  const tokens = address
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const normalized = tokens.map((tok) => {
    if (STREET_SUFFIXES[tok]) return STREET_SUFFIXES[tok];
    if (DIRECTIONALS[tok]) return DIRECTIONALS[tok];
    return tok;
  });

  return normalized.join(" ").trim();
}

/**
 * Loose equality check for two addresses after normalization — useful when
 * an external source's formatting isn't known in advance.
 */
export function addressesMatch(a, b) {
  return normalizeAddress(a) === normalizeAddress(b);
}
