// Registry of per-county parcel GIS sources. Parcel data is jurisdiction-
// specific — there is no single national parcel API (a paid vendor like
// Regrid/Estated is the only way to get one interface for the whole
// country) — so this is built one county at a time, same pattern as every
// other free data source in this app. Add a county by adding an entry here;
// nothing else needs to change.
//
// Verified live against gis.hennepin.us: a real parcel at 4105 Longfellow
// Ave, Minneapolis MN 55407 returned polygon geometry, PID, owner name,
// build year, and lot area via this exact query shape.
export const COUNTY_PARCEL_SOURCES = {
  hennepin: {
    county: "Hennepin County",
    state: "MN",
    serviceUrl: "https://gis.hennepin.us/arcgis/rest/services/HennepinData/LAND_PROPERTY/MapServer/1",
    fields: {
      pid: "PID",
      houseNo: "HOUSE_NO",
      street: "STREET_NM",
      zip: "ZIP_CD",
      munic: "MUNIC_NM",
      owner: "OWNER_NM",
      areaSqFt: "PARCEL_AREA",
      buildYear: "BUILD_YR",
    },
  },
};

export function findParcelSource(countyName) {
  if (!countyName) return null;
  const key = countyName.toLowerCase().replace(/\s+county$/i, "").trim();
  return COUNTY_PARCEL_SOURCES[key] || null;
}
