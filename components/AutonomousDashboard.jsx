"use client";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const SLATE = "#0d1420", PANEL = "#131c2b", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", SIGNAL = "#ef5a6f";

const SUPABASE_URL = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : null;
const SUPABASE_ANON_KEY = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const TIER_COLORS = { hot: SIGNAL, warm: AMBER, cool: BLUE, cold: MUTE, "low-priority": "#8a6bd1", unscored: MUTE };

export default function AutonomousDashboard() {
  const [queue, setQueue] = useState(null);
  const [leads, setLeads] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [{ data: queueRows, error: qErr }, { data: leadRows, error: lErr }] = await Promise.all([
        supabase.from("zip_scan_queue").select("*").order("created_at", { ascending: false }).limit(500),
        supabase.from("leads").select("address,zip,damage_score,tier,updated_at").order("updated_at", { ascending: false }).limit(500),
      ]);
      if (qErr) throw qErr;
      if (lErr) throw lErr;
      setQueue(queueRows || []);
      setLeads(leadRows || []);
    } catch (e) {
      setError(e.message || "Failed to load — has supabase_autonomous_scan_schema.sql been run yet?");
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (!supabase) {
    return (
      <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 40, textAlign: "center" }}>
        <div>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🛰️</div>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Autonomous scanning needs Supabase</div>
          <div style={{ fontSize: 13, color: MUTE, maxWidth: 420 }}>Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, run supabase_autonomous_scan_schema.sql, and enable the /api/auto-scan cron. See AUTONOMOUS.md.</div>
        </div>
      </div>
    );
  }

  const queueCounts = { pending: 0, scanning: 0, done: 0, failed: 0 };
  (queue || []).forEach((q) => { queueCounts[q.status] = (queueCounts[q.status] || 0) + 1; });

  const tierCounts = { hot: 0, warm: 0, cool: 0, cold: 0, "low-priority": 0, unscored: 0 };
  (leads || []).forEach((l) => { tierCounts[l.tier || "unscored"] = (tierCounts[l.tier || "unscored"] || 0) + 1; });

  const recentDone = (queue || []).filter((q) => q.status === "done").slice(0, 15);
  const recentFailed = (queue || []).filter((q) => q.status === "failed").slice(0, 10);
  const hotLeads = (leads || []).filter((l) => l.tier === "hot").sort((a, b) => (b.damage_score || 0) - (a.damage_score || 0)).slice(0, 20);

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "28px 36px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Autonomous Scan — Progress</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={load} disabled={loading} style={{ padding: "8px 14px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, cursor: "pointer" }}>{loading ? "Loading…" : "Refresh"}</button>
          <a href="/batch" style={{ padding: "8px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>Batch pipeline →</a>
        </div>
      </div>

      {error && <div style={{ color: SIGNAL, fontSize: 13, marginBottom: 16 }}>Error: {error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 24 }}>
        {[["Pending ZIPs", queueCounts.pending, BLUE], ["Scanning", queueCounts.scanning, AMBER], ["Done", queueCounts.done, GREEN], ["Failed", queueCounts.failed, SIGNAL],
          ["Total leads", (leads || []).length, TEXT], ["Hot leads", tierCounts.hot, SIGNAL]].map(([label, value, color]) => (
          <div key={label} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10.5, color: MUTE, textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 10 }}>RECENTLY SCANNED ZIPs</div>
          {recentDone.length === 0 ? <div style={{ fontSize: 13, color: MUTE }}>None yet — the cron job runs on its own schedule (see vercel.json).</div> : (
            <div style={{ display: "grid", gap: 6 }}>
              {recentDone.map((q) => (
                <div key={q.zip} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${LINE}`, paddingBottom: 4 }}>
                  <span>{q.zip} <span style={{ color: MUTE }}>({q.state})</span></span>
                  <span style={{ color: MUTE }}>{q.address_count ?? "—"} addr · {q.leads_found ?? "—"} leads</span>
                </div>
              ))}
            </div>
          )}
          {recentFailed.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontFamily: "monospace", color: SIGNAL, margin: "14px 0 8px" }}>FAILED</div>
              <div style={{ display: "grid", gap: 6 }}>
                {recentFailed.map((q) => (
                  <div key={q.zip} title={q.last_error} style={{ fontSize: 12, color: MUTE }}>{q.zip} — {q.last_error}</div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 10 }}>TOP HOT LEADS</div>
          {hotLeads.length === 0 ? <div style={{ fontSize: 13, color: MUTE }}>None yet.</div> : (
            <div style={{ display: "grid", gap: 6 }}>
              {hotLeads.map((l) => (
                <div key={l.address} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${LINE}`, paddingBottom: 4 }}>
                  <span>{l.address}</span>
                  <span style={{ color: TIER_COLORS[l.tier], fontWeight: 700 }}>{l.damage_score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
