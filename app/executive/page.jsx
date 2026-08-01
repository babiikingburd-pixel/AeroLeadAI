"use client";
import { useState } from "react";
import ExecutiveBoardroom from "../../components/ExecutiveBoardroom";
import LeaderboardPanel from "../../components/LeaderboardPanel";
import SystemHealthMonitor from "../../components/SystemHealthMonitor";

const SLATE = "#0d1420", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a", AMBER = "#f5b942";

const TABS = [
  { key: "boardroom", label: "🏛️ Boardroom" },
  { key: "rankings", label: "🏆 Rankings" },
  { key: "health", label: "🩺 Health" },
];

export default function ExecutivePage() {
  const [tab, setTab] = useState("boardroom");

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
      {tab === "boardroom" && <ExecutiveBoardroom />}
      {tab === "rankings" && <div style={{ padding: 24 }}><LeaderboardPanel /></div>}
      {tab === "health" && <div style={{ padding: 24 }}><SystemHealthMonitor /></div>}
    </div>
  );
}
