"use client";
import { useEffect, useState } from "react";
import { HUD } from "../lib/hudTheme";

const STATUS_FILTERS = ["pending", "approved", "rejected", "needs_rescan", "all"];
const STATUS_COLOR = { pending: HUD.amber, approved: HUD.green, rejected: HUD.red, needs_rescan: HUD.cyan };

export default function ImageReviewQueue() {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notesDraft, setNotesDraft] = useState({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = filter === "all" ? "/api/image-review" : `/api/image-review?status=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.ok) setRows(data.rows);
      else { setRows([]); setError(data.error); }
    } catch (e) {
      setRows([]);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [filter]);

  async function setStatus(id, review_status) {
    const notes = notesDraft[id];
    try {
      await fetch("/api/image-review", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, review_status, ...(notes !== undefined && { reviewer_notes: notes }) }),
      });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  const btnStyle = (color) => ({ padding: "5px 10px", borderRadius: 6, border: `1px solid ${color}`, background: "transparent", color, fontSize: 11, cursor: "pointer" });

  return (
    <div style={{ background: "#131c2b", border: `1px solid ${HUD.lineDim}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ fontSize: 11, color: HUD.amber, fontFamily: HUD.fontMono, letterSpacing: "0.05em" }}>IMAGE REVIEW QUEUE</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{
                padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                background: filter === s ? "rgba(95,224,255,0.1)" : "transparent",
                border: `1px solid ${filter === s ? HUD.cyan : HUD.lineDim}`,
                color: filter === s ? HUD.cyan : HUD.muted,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ fontSize: 12, color: HUD.muted }}>Loading…</div>}
      {error && <div style={{ fontSize: 12, color: HUD.red }}>{error}</div>}
      {!loading && !error && rows.length === 0 && <div style={{ fontSize: 12, color: HUD.muted }}>Nothing in this filter.</div>}

      <div style={{ display: "grid", gap: 10, maxHeight: 640, overflowY: "auto" }}>
        {rows.map((row) => (
          <div key={row.id} style={{ display: "flex", gap: 12, padding: 10, border: `1px solid ${HUD.lineDim}`, borderRadius: 8 }}>
            <div style={{ width: 96, height: 96, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: "#0a1120", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {row.image_url ? (
                <img src={row.image_url} alt={row.address} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 10, color: HUD.muted, textAlign: "center", padding: 6 }}>awaiting imagery</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 13, color: HUD.ice, fontWeight: 600 }}>{row.address}</div>
                <span style={{ fontSize: 10, color: STATUS_COLOR[row.review_status] || HUD.muted, fontFamily: HUD.fontMono }}>{row.review_status}</span>
              </div>
              <div style={{ fontSize: 11, color: HUD.muted, marginBottom: 6 }}>
                {row.city} · {row.region} · rank #{row.national_rank} · {row.priority_band}
              </div>
              <input
                placeholder="Reviewer notes…"
                defaultValue={row.reviewer_notes || ""}
                onChange={(e) => setNotesDraft((d) => ({ ...d, [row.id]: e.target.value }))}
                style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", marginBottom: 8, background: "#0d1420", border: `1px solid ${HUD.lineDim}`, borderRadius: 6, color: HUD.ice, fontSize: 12 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setStatus(row.id, "approved")} style={btnStyle(HUD.green)}>Approve</button>
                <button onClick={() => setStatus(row.id, "rejected")} style={btnStyle(HUD.red)}>Reject</button>
                <button onClick={() => setStatus(row.id, "needs_rescan")} style={btnStyle(HUD.cyan)}>Needs rescan</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
