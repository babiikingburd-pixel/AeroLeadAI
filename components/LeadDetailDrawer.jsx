"use client";
import { useState } from "react";
import { addNote, addTask, toggleTask, logCommunication } from "../lib/leadStore";
import { downloadIcs } from "../lib/calendar";
import ConfidenceCard from "./ConfidenceCard";
import ReportGenerator from "./ReportGenerator";
import SalesIntelligencePanel from "./SalesIntelligencePanel";
import ImageryCompare from "./ImageryCompare";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", BLUE = "#2e7dd1";
const TABS = ["Overview", "Notes", "Tasks", "Calendar", "Communications", "Imagery", "Report", "Scoring"];

// Advanced CRM Automation — full lead detail: notes log, task management,
// calendar (.ics) integration, and email/SMS logging, alongside the
// confidence card, historical imagery compare, report generator, and sales
// scoring built earlier. One place to manage a lead end-to-end.
export default function LeadDetailDrawer({ lead, onClose, onChange }) {
  const [tab, setTab] = useState("Overview");
  const [noteText, setNoteText] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [commSummary, setCommSummary] = useState("");
  const [commMsg, setCommMsg] = useState("");

  const refresh = () => onChange?.();

  async function logComm(channel) {
    if (!commSummary.trim()) return;
    logCommunication(lead.address, channel, commSummary.trim());
    try {
      const res = await fetch("/api/comm-log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel, to: lead.address, address: lead.address, summary: commSummary.trim() }) });
      const d = await res.json();
      setCommMsg(d.note);
    } catch { setCommMsg("Logged locally (send failed)."); }
    setCommSummary("");
    refresh();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100%)", height: "100%", background: "#0b0f16", overflowY: "auto", padding: 20, color: "#dfe6ee", fontFamily: "Inter, system-ui, sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontFamily: "monospace", color: AMBER }}>LEAD DETAIL</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{lead.address}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTE, fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14, borderBottom: `1px solid ${LINE}`, paddingBottom: 10 }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ padding: "6px 10px", background: tab === t ? AMBER : "transparent", color: tab === t ? "#1a1200" : MUTE, border: "none", borderRadius: 6, fontSize: 12, fontWeight: tab === t ? 700 : 500, cursor: "pointer" }}>{t}</button>
          ))}
        </div>

        {tab === "Overview" && <ConfidenceCard lead={lead} />}

        {tab === "Notes" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note…"
                style={{ flex: 1, padding: "8px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13 }} />
              <button onClick={() => { if (noteText.trim()) { addNote(lead.address, noteText.trim()); setNoteText(""); refresh(); } }}
                style={{ padding: "8px 14px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Add</button>
            </div>
            {(lead.notes_log || []).length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No notes yet.</div>}
            {(lead.notes_log || []).map((n) => (
              <div key={n.id} style={{ padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 13 }}>{n.text}</div>
                <div style={{ fontSize: 11, color: MUTE }}>{new Date(n.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "Tasks" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task…"
                style={{ flex: 1, minWidth: 140, padding: "8px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13 }} />
              <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)}
                style={{ padding: "8px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13 }} />
              <button onClick={() => { if (taskTitle.trim()) { addTask(lead.address, taskTitle.trim(), taskDue || null); setTaskTitle(""); setTaskDue(""); refresh(); } }}
                style={{ padding: "8px 14px", background: AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Add</button>
            </div>
            {(lead.tasks || []).length === 0 && <div style={{ fontSize: 12, color: MUTE }}>No tasks yet.</div>}
            {(lead.tasks || []).map((t) => (
              <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: `1px solid ${LINE}`, cursor: "pointer", textDecoration: t.done ? "line-through" : "none", color: t.done ? MUTE : "#dfe6ee" }}>
                <input type="checkbox" checked={t.done} onChange={() => { toggleTask(lead.address, t.id); refresh(); }} />
                <span style={{ flex: 1, fontSize: 13 }}>{t.title}</span>
                {t.dueDate && <span style={{ fontSize: 11, color: MUTE }}>{t.dueDate}</span>}
              </label>
            ))}
          </div>
        )}

        {tab === "Calendar" && (
          <div>
            <div style={{ fontSize: 13, marginBottom: 10 }}>Follow-up: <b>{lead.followUp ? new Date(lead.followUp).toLocaleDateString() : "not set"}</b></div>
            <button onClick={() => downloadIcs(lead)} style={{ padding: "8px 14px", background: BLUE, border: "none", borderRadius: 6, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>📅 Download .ics (Google/Outlook/Apple)</button>
          </div>
        )}

        {tab === "Communications" && (
          <div>
            <textarea value={commSummary} onChange={(e) => setCommSummary(e.target.value)} placeholder="What was said / sent…" rows={3}
              style={{ width: "100%", padding: "8px 10px", background: PANEL, border: `1px solid ${LINE}`, borderRadius: 6, color: "#dfe6ee", fontSize: 13, marginBottom: 8 }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button onClick={() => logComm("email")} style={{ padding: "8px 14px", background: BLUE, border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 13 }}>✉ Log email</button>
              <button onClick={() => logComm("sms")} style={{ padding: "8px 14px", background: GREEN, border: "none", borderRadius: 6, color: "#0d1420", cursor: "pointer", fontSize: 13 }}>💬 Log SMS</button>
            </div>
            {commMsg && <div style={{ fontSize: 11, color: MUTE, marginBottom: 8 }}>{commMsg}</div>}
            {(lead.comm_log || []).map((c) => (
              <div key={c.id} style={{ padding: "8px 0", borderTop: `1px solid ${LINE}` }}>
                <div style={{ fontSize: 11, color: AMBER, textTransform: "uppercase" }}>{c.channel}</div>
                <div style={{ fontSize: 13 }}>{c.summary}</div>
                <div style={{ fontSize: 11, color: MUTE }}>{new Date(c.at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "Imagery" && (
          <ImageryCompare current={lead.imagery?.[0]} historical={lead.historical} />
        )}

        {tab === "Report" && <ReportGenerator lead={lead} />}
        {tab === "Scoring" && <SalesIntelligencePanel lead={lead} onScored={refresh} />}
      </div>
    </div>
  );
}
