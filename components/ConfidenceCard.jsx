"use client";
// AI Confidence & Explainability: every scored property shows damage
// probability, why the AI flagged it, a confidence percentage, and the
// supporting imagery — so a homeowner-facing rep can defend the score.
const CONF_PCT = { low: 45, medium: 70, high: 90 };

export default function ConfidenceCard({ lead }) {
  const score = lead.findingsScore ?? null;
  const confPct = CONF_PCT[lead.confidence] ?? (score != null ? 60 : null);
  const level = score == null ? "unscored" : score >= 75 ? "severe" : score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  const color = level === "severe" ? "#e5534b" : level === "high" ? "#f5a623" : level === "moderate" ? "#2e7dd1" : "#4caf7d";

  return (
    <div style={{ background: "#141b26", border: "1px solid #232f3e", borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: "#f5a623", marginBottom: 10 }}>AI ASSESSMENT · {lead.address}</div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#6b7c93" }}>Damage probability</div>
          <div style={{ fontSize: 30, fontWeight: 800, color }}>{score != null ? `${score}%` : "—"}</div>
          <div style={{ fontSize: 11, color }}>{level}</div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#6b7c93" }}>Model confidence</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "#dfe6ee" }}>{confPct != null ? `${confPct}%` : "—"}</div>
          <div style={{ fontSize: 11, color: "#6b7c93" }}>{lead.confidence || "not reported"}</div>
        </div>
      </div>

      {confPct != null && (
        <div style={{ height: 6, background: "#0b0f16", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ width: `${confPct}%`, height: "100%", background: color }} />
        </div>
      )}

      <div style={{ fontSize: 11, color: "#6b7c93", marginBottom: 4 }}>Why the AI flagged this property</div>
      {lead.indicators?.length ? (
        <ul style={{ margin: "0 0 10px", paddingLeft: 18, color: "#dfe6ee", fontSize: 13 }}>
          {lead.indicators.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ) : (
        <div style={{ fontSize: 13, color: "#6b7c93", marginBottom: 10 }}>No specific indicators recorded — run a scan from the Console for a full finding.</div>
      )}
      {lead.notes && <div style={{ fontSize: 12, color: "#9fb0c3", fontStyle: "italic", marginBottom: 10 }}>"{lead.notes}"</div>}

      {lead.imagery?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "#6b7c93", marginBottom: 6 }}>Supporting imagery</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {lead.imagery.slice(0, 4).map((src, i) => (
              <img key={i} src={src} alt={`evidence ${i + 1}`} style={{ width: 110, height: 82, objectFit: "cover", borderRadius: 6, border: "1px solid #232f3e" }} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
