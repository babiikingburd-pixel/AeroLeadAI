import { DOCTOR_REQUIREMENTS, type DoctorRequirementKey } from "./requirements";

export type DoctorCheck = {
  key: DoctorRequirementKey;
  label: string;
  complete: boolean;
  status: "COMPLETE" | "READY" | "WAITING_DEPENDENCY";
  provider: string;
  repairAction: string;
  evidenceProvider?: string;
};

export type DoctorAudit = {
  parcelId: string;
  complete: boolean;
  completeCount: number;
  requiredCount: number;
  completionPct: number;
  missing: DoctorRequirementKey[];
  nextAction: DoctorCheck | null;
  checklist: DoctorCheck[];
  auditedAt: string;
};

const real = (row: any) => row && (row.reality === "REAL_NOW" || row.reality === "CACHED_REAL");
const hasValue = (input: unknown) => input !== null && input !== undefined && String(input).trim() !== "";
const coordinate = (input: unknown, limit: number) => Number.isFinite(Number(input)) && Math.abs(Number(input)) <= limit;

export function auditProperty(profile: any, evidence: any[], auditedAt = new Date().toISOString()): DoctorAudit {
  const usable = evidence.filter(real);
  const latest = (type: string) => usable.find((row: any) => row.type === type);
  const structure = latest("STRUCTURE");
  const imagery = latest("IMAGERY");
  const permit = latest("PERMIT");
  const weather = latest("WEATHER");
  const structurePayload = structure?.payload || {};
  const imageryPayload = imagery?.payload || {};
  const propertyType = structurePayload.property_type ?? structurePayload.dwelling_type ?? structurePayload.use_type;
  const yearBuilt = Number(structurePayload.year_built ?? structurePayload.yearBuilt ?? structurePayload.effective_year_built);
  const analysisStatus = String(imageryPayload.damage_analysis_status ?? imageryPayload.analysis_status ?? "").toLowerCase();

  const checks: Record<DoctorRequirementKey, { complete: boolean; evidenceProvider?: string }> = {
    identity: { complete: hasValue(profile?.parcel_id) && hasValue(profile?.address) && hasValue(profile?.zip) },
    geolocation: { complete: coordinate(structurePayload.latitude, 90) && coordinate(structurePayload.longitude, 180), evidenceProvider: structure?.provider },
    property_classification: { complete: hasValue(propertyType), evidenceProvider: structure?.provider },
    year_built: { complete: Number.isInteger(yearBuilt) && yearBuilt >= 1600 && yearBuilt <= new Date(auditedAt).getUTCFullYear(), evidenceProvider: structure?.provider },
    imagery_capture: { complete: Boolean(imagery && hasValue(imageryPayload.storage_path)), evidenceProvider: imagery?.provider },
    imagery_date: { complete: Boolean(imagery && (hasValue(imageryPayload.capture_date) || hasValue(imagery.effective_at))), evidenceProvider: imagery?.provider },
    imagery_analysis: { complete: ["complete", "completed", "analyzed", "reviewed"].includes(analysisStatus), evidenceProvider: imagery?.provider },
    permit_history: { complete: Boolean(permit), evidenceProvider: permit?.provider },
    weather_history: { complete: Boolean(weather), evidenceProvider: weather?.provider },
  };

  const completed = new Set<DoctorRequirementKey>();
  for (const requirement of DOCTOR_REQUIREMENTS) if (checks[requirement.key].complete) completed.add(requirement.key);
  const checklist = DOCTOR_REQUIREMENTS.map((requirement): DoctorCheck => {
    const check = checks[requirement.key];
    const dependencyMet = !requirement.dependsOn || completed.has(requirement.dependsOn);
    return {
      key: requirement.key,
      label: requirement.label,
      complete: check.complete,
      status: check.complete ? "COMPLETE" : dependencyMet ? "READY" : "WAITING_DEPENDENCY",
      provider: requirement.provider,
      repairAction: requirement.repairAction,
      evidenceProvider: check.evidenceProvider,
    };
  });
  const completeCount = checklist.filter(check => check.complete).length;
  const missing = checklist.filter(check => !check.complete).map(check => check.key);
  const nextAction = checklist.find(check => check.status === "READY") || checklist.find(check => !check.complete) || null;
  return {
    parcelId: profile?.parcel_id || "",
    complete: missing.length === 0,
    completeCount,
    requiredCount: checklist.length,
    completionPct: Math.round((completeCount / checklist.length) * 100),
    missing,
    nextAction,
    checklist,
    auditedAt,
  };
}

