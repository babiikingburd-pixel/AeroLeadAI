"use client";
import { useState } from "react";
import BusinessIntelligence from "../../components/BusinessIntelligence";
import ImmediateIntelligencePanel from "../../components/ImmediateIntelligencePanel";
import MaintenanceConsole from "../../components/MaintenanceConsole";

const SLATE = "#0d1420", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a", AMBER = "#f5b942";

const TABS = [
  { key: "intelligence", label: "📊 Intelligence" },
  { key: "maintenance", label: "🔧 Maintenance" },
];

export default function IntelligencePage() {
  const [tab, setTab] = useState("intelligence");

  return (
    <div style={{ background: SLATE, minHeight: "100vh" }}>
      <div style={{ display: "flex", gap: 4, padding: "10px 28px 0", borderBottom: `1px solid ${LINE}` }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              borderBottom: tab === t.key ? `2px solid ${AMBER}` : "2px solid transparent",
              color: tab === t.key ? TEXT : MUTE,
              fontFamily: "Inter, system-ui, sans-serif",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "intelligence" ? (
        <>
          <div style={{ padding: "18px 28px 0" }}><ImmediateIntelligencePanel /></div>
          <BusinessIntelligence />
        </>
      ) : <MaintenanceConsole />}
    </div>
  );
}
