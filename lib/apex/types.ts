// These types describe tables that ALREADY EXIST in the live Supabase
// project (dikxsdjlrbdowozjkefw) — top500_slots, top500_crawler_lanes,
// top500_crawler_tasks, top500_crawler_findings, apex_evidence_events,
// twincities_apex_controls, twincities_apex_cycles, twincities_apex_decisions.
//
// This file does NOT define new tables. A prior design pass (outside this
// codebase) proposed a parallel investigation_queue/investigation_evidence
// schema — that would have been a second, competing system. The real gap
// was never a missing schema; it was that nothing was writing to the
// schema that already exists. top500_slots had 500 empty rows and
// top500_crawler_tasks had zero rows before this pass.

export type LaneName =
  | "competition"
  | "residential"
  | "permits"
  | "imagery"
  | "storm"
  | "damage"
  | "development";

export type TaskStatus = "queued" | "running" | "completed" | "failed";

export interface CrawlerLane {
  lane_name: LaneName;
  enabled: boolean;
  interval_seconds: number;
  priority: number;
  description: string | null;
}

export interface Top500Slot {
  slot_no: number;
  property_id: string | null;
  rank: number | null;
  score: number;
  evidence_confidence: number;
  evidence_completeness: number;
  residential_confidence: number;
  status: string;
  last_investigated_at: string | null;
  next_investigation_at: string | null;
}

export interface CrawlerTask {
  task_id: string;
  slot_no: number;
  property_id: string;
  lane_name: LaneName;
  priority: number;
  status: TaskStatus;
}

export interface ApexControls {
  enabled: boolean;
  max_daily_promotions: number;
  min_confidence_for_promotion: number;
  min_evidence_quality_for_promotion: number;
  min_confidence_for_candidate: number;
  min_evidence_quality_for_candidate: number;
  stability_cycles: number;
  top_n: number;
  paid_lookups_enabled: boolean;
  permit_daily_call_cap: number;
  imagery_daily_call_cap: number;
}

export interface LaneResult {
  claim: string;
  evidence: Record<string, unknown>;
  confidence: number; // 0-100
  verification_status: "verified" | "unverified" | "insufficient_data";
}
