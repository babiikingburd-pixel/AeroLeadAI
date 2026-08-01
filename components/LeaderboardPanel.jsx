"use client";
import { useEffect, useState } from "react";
import { HUD } from "../lib/hudTheme";

const SCOPES = [
  { key: "national", label: "National" },
  { key: "East", label: "East" },
  { key: "Midwest", label: "Midwest" },
  { key: "South", label: "South" },
  { key: "West", label: "West" },
];

export default function LeaderboardPanel() {
  const [scope, setScope] = useState("national");
  const [limit, setLimit] = useState(100);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = scope === "national" ? `/api/rankings/national?limit=${limit}` : `/api/rankings/regional?region=${scope}&limit=${limit}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.ok) setRows(data.rows);
        else { setRows([]); setError(data.error); }
      })
      .catch((e) => { if (!cancelled) { setRows([]); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, limit]);

  const rankKey = scope === "national" ? "national_rank" : "regional_rank";

  return (
    <div style={{ background: "#131c2b", border: `1px solid ${HUD.lineDim}`, borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              style={{
                padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                background: scope === s.key ? "rgba(95,224,255,0.1)" : "transparent",
                border: `1px solid ${scope === s.key ? HUD.cyan : HUD.lineDim}`,
                color: scope === s.key ? HUD.cyan : HUD.muted,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[100, 200].map((n) => (
            <button
              key={n}
              onClick={() => setLimit(n)}
              style={{
                padding: "5px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                background: "transparent", border: `1px solid ${limit === n ? HUD.amber : HUD.lineDim}`,
                color: limit === n ? HUD.amber : HUD.muted,
              }}
            >
              Top {n}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ fontSize: 12, color: HUD.muted }}>Loading…</div>}
      {error && <div style={{ fontSize: 12, color: HUD.red }}>{error}</div>}
      {!loading && !error && rows.length === 0 && <div style={{ fontSize: 12, color: HUD.muted }}>No rows returned.</div>}

      {rows.length > 0 && (
        <div style={{ maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: HUD.muted, textAlign: "left", position: "sticky", top: 0, background: "#131c2b" }}>
                <th style={{ padding: "6px 8px" }}>#</th>
                <th style={{ padding: "6px 8px" }}>Address</th>
                <th style={{ padding: "6px 8px" }}>City / ZIP</th>
                <th style={{ padding: "6px 8px" }}>Priority</th>
                <th style={{ padding: "6px 8px" }}>Est. cost</th>
                <th style={{ padding: "6px 8px" }}>Latest permit</th>
                <th style={{ padding: "6px 8px" }}>Built</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.address}-${r[rankKey]}`} style={{ borderTop: `1px solid ${HUD.lineDim}` }}>
                  <td style={{ padding: "6px 8px", color: HUD.cyan, fontFamily: HUD.fontMono }}>{r[rankKey]}</td>
                  <td style={{ padding: "6px 8px", color: HUD.ice }}>{r.address}</td>
                  <td style={{ padding: "6px 8px", color: HUD.muted }}>{r.city} {r.zip}</td>
                  <td style={{ padding: "6px 8px", color: HUD.ice }}>{r.priority_band || "—"}{r.priority_bucket ? ` (${r.priority_bucket})` : ""}</td>
                  <td style={{ padding: "6px 8px", color: HUD.muted }}>{r.replacement_cost_estimate ? `$${Number(r.replacement_cost_estimate).toLocaleString()}` : "—"}</td>
                  <td style={{ padding: "6px 8px", color: HUD.muted }}>{r.latest_permit_date ? `${r.latest_permit_type || "permit"} · ${new Date(r.latest_permit_date).toLocaleDateString()}` : "none on file"}</td>
                  <td style={{ padding: "6px 8px", color: HUD.muted }}>{r.year_built || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
