"use client";
import { useEffect, useRef, useState } from "react";
import { getJobByToken } from "../lib/opsStore";

const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", RED = "#ef5a6f";

const STATUS_LABEL = { new: "Received", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", canceled: "Canceled" };

// Customer Intelligence Portal (partial build — see stubs below). Token-gated
// (not the internal password/magic-link gate), read-only + AI chat for the
// homeowner tied to this specific job. Live technician tracking, digital
// contracts, and in-app payments need a GPS/location source, an e-signature
// vendor, and a payment processor respectively — none configured, so those
// sections say so plainly instead of faking data.
export default function CustomerPortal({ token }) {
  const [job, setJob] = useState(undefined); // undefined = loading, null = not found
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    getJobByToken(token).then(setJob);
  }, [token]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    const nextMessages = [...messages, { role: "user", text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/portal-chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: nextMessages, job }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "assistant", text: data.error || data.reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: "Sorry, something went wrong reaching support. Please try again." }]);
    } finally {
      setSending(false);
    }
  }

  if (job === undefined) {
    return <div style={{ minHeight: "100vh", background: SLATE, color: MUTE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif" }}>Loading…</div>;
  }
  if (job === null) {
    return (
      <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", textAlign: "center", padding: 20 }}>
        <div>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Link not found</div>
          <div style={{ fontSize: 13, color: MUTE }}>This portal link is invalid, or Supabase isn't configured. Contact your project contact for a new link.</div>
        </div>
      </div>
    );
  }

  const timeline = [
    { label: "Request received", date: job.created_at },
    job.scheduled_date && { label: "Scheduled", date: job.scheduled_date },
    job.completed_date && { label: "Completed", date: job.completed_date },
  ].filter(Boolean);

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "24px 20px", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
      <h1 style={{ fontSize: 22, margin: "4px 0 4px" }}>{job.address}</h1>
      <div style={{ fontSize: 13, color: MUTE, marginBottom: 20 }}>Status: <span style={{ color: TEXT, fontWeight: 700 }}>{STATUS_LABEL[job.status] || job.status}</span>{job.contractors?.name ? ` · Contractor: ${job.contractors.name}` : ""}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase" }}>Instant estimate</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: GREEN }}>{job.revenue_estimate ? `$${Number(job.revenue_estimate).toLocaleString()}` : "Pending"}</div>
          <div style={{ fontSize: 11, color: MUTE }}>Rough estimate — a final number comes after inspection.</div>
        </div>
        <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase" }}>AI damage assessment</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{job.findings_score != null ? `${job.findings_score}/100` : "Pending"}</div>
          <div style={{ fontSize: 11, color: MUTE }}>Concern score from aerial imagery review.</div>
        </div>
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14, marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: AMBER, marginBottom: 10 }}>PROPERTY HISTORY</div>
        {timeline.map((t, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderTop: i ? `1px solid ${LINE}` : "none" }}>
            <span>{t.label}</span><span style={{ color: MUTE }}>{new Date(t.date).toLocaleDateString()}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
        {[
          ["📍 Live technician tracking", "Needs a mobile app or phone GPS check-in — not set up yet."],
          ["✍️ Digital contract", "Needs an e-signature vendor (e.g. DocuSign) — not set up yet."],
          ["💳 In-app payment", "Needs a payment processor (e.g. Stripe) — not set up yet."],
        ].map(([title, note]) => (
          <div key={title} style={{ background: PANEL2, border: `1px dashed ${LINE}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>
            <div style={{ fontSize: 11, color: MUTE }}>{note}</div>
          </div>
        ))}
      </div>

      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 11, color: AMBER, marginBottom: 10 }}>ASK A QUESTION</div>
        <div style={{ maxHeight: 260, overflowY: "auto", marginBottom: 10 }}>
          {messages.length === 0 && <div style={{ fontSize: 12, color: MUTE }}>Ask about your project's status, estimate, or timeline.</div>}
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 8, textAlign: m.role === "user" ? "right" : "left" }}>
              <span style={{ display: "inline-block", maxWidth: "80%", padding: "8px 12px", borderRadius: 12, fontSize: 13, background: m.role === "user" ? BLUE : PANEL2, color: m.role === "user" ? "#fff" : TEXT }}>{m.text}</span>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Type your question…" style={{ flex: 1, padding: "8px 10px", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, fontSize: 13 }} />
          <button onClick={sendMessage} disabled={sending} style={{ padding: "8px 16px", background: sending ? MUTE : AMBER, border: "none", borderRadius: 6, color: "#1a1200", fontWeight: 700, cursor: sending ? "default" : "pointer", fontSize: 13 }}>{sending ? "…" : "Send"}</button>
        </div>
      </div>
    </div>
  );
}
