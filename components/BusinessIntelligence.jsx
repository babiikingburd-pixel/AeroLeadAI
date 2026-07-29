"use client";
import { useEffect, useState } from "react";
import { listJobs, listContractors } from "../lib/opsStore";
import { importConsoleProperties } from "../lib/leadStore";
import { demandByZip, revenueForecast, underservedMarkets, contractorPerformance, pricingSignal, suggestDispatch } from "../lib/businessIntelligence";
import PhaseTwoIntelligencePanel from "./PhaseTwoIntelligencePanel";
import { supabase, isSupabaseConfigured } from "../lib/supabase";

const SLATE = "#0d1420", PANEL = "#131c2b", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", RED = "#ef5a6f";

export default function BusinessIntelligence() {
  const [leads, setLeads] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [contractors, setContractors] = useState([]);

  const [liveLeads, setLiveLeads] = useState([]);
  const [liveConnected, setLiveConnected] = useState(false);

  async function refresh() {
    setLeads(importConsoleProperties());
    setJobs(await listJobs());
    setContractors(await listContractors());
  }
  useEffect(() => { refresh(); }, []);

  // Live scan feed: real-time INSERTs on the Supabase `leads` table (fed by
  // /api/scan/continuous and /api/scan/storm), falling back to polling
  // /api/leads every 30s when Supabase realtime isn't reachable/configured.
  useEffect(() => {
    let pollId;

    async function pollLeads() {
      try {
        const res = await fetch("/api/leads?limit=20");
        const data = await res.json();
        if (data.success) setLiveLeads(data.leads);
      } catch {}
    }

    if (!isSupabaseConfigured || !supabase) {
      pollLeads();
      pollId = setInterval(pollLeads, 30000);
      return () => clearInterval(pollId);
    }

    pollLeads();
    const channel = supabase
      .channel("leads-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, (payload) => {
        setLiveLeads((prev) => [payload.new, ...prev].slice(0, 20));
      })
      .subscribe((status) => {
        const connected = status === "SUBSCRIBED";
        setLiveConnected(connected);
        if (!connected && !pollId) pollId = setInterval(pollLeads, 30000);
        if (connected && pollId) { clearInterval(pollId); pollId = null; }
      });

    return () => {
      supabase.removeChannel(channel);
      if (pollId) clearInterval(pollId);
    };
  }, []);

  const demand = demandByZip(leads);
  const forecast = revenueForecast(jobs);
  const underserved = underservedMarkets(leads, contractors);
  const performance = contractorPerformance(jobs, contractors);
  const pricing = pricingSignal(jobs);
  const dispatch = suggestDispatch(jobs, contractors);

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 28px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>AI Business Intelligence Engine</h1>
          <p style={{ color: MUTE, fontSize: 12, margin: "4px 0 0", maxWidth: 700 }}>
            Computed from your own lead/job data — directional signal, not a robust forecast until there's more history. No simulated numbers; small-sample caveats are called out below rather than hidden.
          </p>
        </div>
        <button onClick={refresh} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: GREEN, cursor: "pointer", fontSize: 13 }}>↻ Refresh</button>
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 16, maxHeight: 220, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: liveConnected ? GREEN : MUTE,
            boxShadow: liveConnected ? `0 0 0 0 ${GREEN}` : "none",
            animation: liveConnected ? "aerolead-pulse 1.6s infinite" : "none",
          }} />
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace" }}>LIVE SCAN FEED ({liveLeads.length})</div>
          <span style={{ fontSize: 11, color: MUTE }}>{liveConnected ? "realtime connected" : "polling every 30s"}</span>
        </div>
        <style>{`@keyframes aerolead-pulse { 0% { box-shadow: 0 0 0 0 rgba(79,201,142,0.6); } 70% { box-shadow: 0 0 0 6px rgba(79,201,142,0); } 100% { box-shadow: 0 0 0 0 rgba(79,201,142,0); } }`}</style>
        {liveLeads.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No scanned leads yet — run a scan from the Maintenance Console.</div>}
        {liveLeads.map((l) => (
          <div key={l.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderTop: `1px solid ${LINE}` }}>
            <span>{l.address}</span>
            <span style={{ color: MUTE }}>{l.urgency ? `${l.urgency} urgency` : ""}{l.est_value ? ` · ${l.est_value}` : ""}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>REVENUE FORECAST</div>
          {forecast.trend === "insufficient-data" ? (
            <div style={{ fontSize: 13, color: MUTE }}>{forecast.note}</div>
          ) : (
            <>
              <div style={{ fontSize: 26, fontWeight: 800, color: forecast.trend === "up" ? GREEN : forecast.trend === "down" ? RED : TEXT }}>
                {forecast.trend === "up" ? "↑" : forecast.trend === "down" ? "↓" : "→"} {forecast.pctChange > 0 ? "+" : ""}{forecast.pctChange}%
              </div>
              <div style={{ fontSize: 12, color: MUTE }}>Next-month projection: ${forecast.nextMonthProjection?.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: MUTE, marginTop: 6 }}>{forecast.note}</div>
            </>
          )}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>PRICING SIGNAL</div>
          {pricing.available ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{pricing.medianActualVsEstimateRatio}×</div>
              <div style={{ fontSize: 12, color: MUTE }}>median actual ÷ estimate, {pricing.sampleSize} job(s)</div>
              <div style={{ fontSize: 11, color: MUTE, marginTop: 6 }}>{pricing.note}</div>
            </>
          ) : <div style={{ fontSize: 13, color: MUTE }}>{pricing.note}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 320, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>DEMAND BY ZIP ({demand.length})</div>
          {demand.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No leads yet.</div>}
          {demand.slice(0, 15).map((d) => (
            <div key={d.zip} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderTop: `1px solid ${LINE}` }}>
              <span>{d.zip}</span>
              <span style={{ color: MUTE }}>{d.count} lead(s){d.avgScore != null ? ` · avg score ${d.avgScore}` : ""}</span>
            </div>
          ))}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 320, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>UNDERSERVED MARKETS — RECRUITING TARGETS ({underserved.length})</div>
          {underserved.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No gaps detected — either coverage is good, or there's not enough lead volume yet to tell.</div>}
          {underserved.slice(0, 15).map((d) => (
            <div key={d.zip} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderTop: `1px solid ${LINE}` }}>
              <span>{d.zip}</span>
              <span style={{ color: RED }}>{d.count} lead(s), no contractor coverage</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 320, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>CONTRACTOR PERFORMANCE</div>
          {performance.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No contractors yet — add some in the Operations Command Center.</div>}
          {performance.map((p) => (
            <div key={p.id} style={{ fontSize: 12, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
              <b>{p.name}</b> — {p.jobsCompleted}/{p.jobsAssigned} completed
              {p.completionRate != null && `, ${p.completionRate}% completion rate`}
              {p.onTimeRate != null && `, ${p.onTimeRate}% on-time`}
              <div style={{ color: GREEN }}>${p.revenue.toLocaleString()} revenue</div>
            </div>
          ))}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, maxHeight: 320, overflowY: "auto" }}>
          <div style={{ fontSize: 11, color: AMBER, fontFamily: "monospace", marginBottom: 10 }}>DISPATCH SUGGESTIONS ({dispatch.length})</div>
          {dispatch.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No unassigned jobs with an available contractor to suggest.</div>}
          {dispatch.slice(0, 15).map((d, i) => (
            <div key={i} style={{ fontSize: 12, padding: "6px 0", borderTop: `1px solid ${LINE}` }}>
              <b>{d.job.address}</b> → {d.suggestedContractor.name} <span style={{ color: MUTE }}>(~{d.approxMiles} mi, straight-line)</span>
            </div>
          ))}
        </div>
      </div>

      <PhaseTwoIntelligencePanel />
    </div>
  );
}
