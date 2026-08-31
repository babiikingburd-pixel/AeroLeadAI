export type DoctorRequirementKey =
  | "identity"
  | "geolocation"
  | "property_classification"
  | "year_built"
  | "imagery_capture"
  | "imagery_date"
  | "imagery_analysis"
  | "permit_history"
  | "weather_history";

export type DoctorRequirement = {
  key: DoctorRequirementKey;
  label: string;
  priority: number;
  provider: string;
  repairAction: string;
  dependsOn?: DoctorRequirementKey;
};

// The canonical contract for a complete Oversight property profile.
export const DOCTOR_REQUIREMENTS: readonly DoctorRequirement[] = [
  { key: "identity", label: "Property identity", priority: 100, provider: "property registry", repairAction: "Resolve the parcel ID, street address and ZIP." },
  { key: "geolocation", label: "Verified coordinates", priority: 98, provider: "county/Census geocoder", repairAction: "Resolve and persist parcel latitude and longitude." },
  { key: "property_classification", label: "Property classification", priority: 94, provider: "county assessor", repairAction: "Confirm residential/commercial class and dwelling type." },
  { key: "year_built", label: "Year built", priority: 92, provider: "county assessor", repairAction: "Retrieve the public construction year." },
  { key: "imagery_capture", label: "Property imagery", priority: 90, provider: "imagery provider", repairAction: "Fetch and privately store a real property image.", dependsOn: "geolocation" },
  { key: "imagery_date", label: "Imagery date", priority: 86, provider: "imagery metadata", repairAction: "Retrieve the provider's actual image capture date.", dependsOn: "imagery_capture" },
  { key: "imagery_analysis", label: "Roof imagery analysis", priority: 84, provider: "vision review", repairAction: "Analyze the stored roof image and persist the result.", dependsOn: "imagery_capture" },
  { key: "permit_history", label: "Roof permit search", priority: 82, provider: "permit provider", repairAction: "Search the full permit window and record matches or a verified no-match." },
  { key: "weather_history", label: "Storm history search", priority: 80, provider: "NOAA/NWS", repairAction: "Search hail and wind history and record matches or a verified no-match.", dependsOn: "geolocation" },
] as const;

