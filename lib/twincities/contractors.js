// Registry of contractor "top N opportunities" report configs.
//
// Add a contractor here and it's immediately live at:
//   /twincities/reports/<slug>        (printable report page)
//   /api/reports/<slug>               (JSON, same data the page fetches)
//
// No new route code needed per contractor — this is what replaced the
// one-off /api/apex10 + /twincities/apex10 pair. limit is how many
// opportunities the report shows (10 or 20 are the two sizes used so far;
// any number works).
export const CONTRACTORS = {
  "apex-exteriors": {
    displayName: "APEX Exteriors",
    serviceAreaCities: [
      "Plymouth", "Maple Grove", "Brooklyn Park", "Champlin", "Golden Valley",
      "Minnetonka", "Wayzata", "Deephaven", "Edina", "Eden Prairie",
      "St. Louis Park", "Hopkins", "New Hope", "Crystal", "Robbinsdale",
    ],
    limit: 10,
  },

  // Add the next contractor here, e.g.:
  // "north-metro-roofing": {
  //   displayName: "North Metro Roofing Co.",
  //   serviceAreaCities: ["Blaine", "Coon Rapids", "Andover", "Anoka", "Ramsey"],
  //   limit: 20,
  // },
};

export function getContractor(slug) {
  return CONTRACTORS[slug] || null;
}

export function listContractorSlugs() {
  return Object.keys(CONTRACTORS);
}
