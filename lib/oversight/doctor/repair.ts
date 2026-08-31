import type { DoctorAudit, DoctorCheck } from "./audit";

export type DoctorRepairPlan = {
  parcelId: string;
  ready: DoctorCheck[];
  waiting: DoctorCheck[];
  next: DoctorCheck | null;
};

export function planRepairs(audit: DoctorAudit): DoctorRepairPlan {
  return {
    parcelId: audit.parcelId,
    ready: audit.checklist.filter(check => check.status === "READY"),
    waiting: audit.checklist.filter(check => check.status === "WAITING_DEPENDENCY"),
    next: audit.nextAction,
  };
}

