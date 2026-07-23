"use client";
import { useEffect, useState } from "react";
import RoofAnnotationViewer from "./RoofAnnotationViewer";

const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a", TEXT = "#dfe6ee", MUTE = "#77839a";
const AMBER = "#f5b942", GREEN = "#4fc98e", RED = "#ef5a6f", BLUE = "#4fa3e3";

const STATUS_LABEL = { new: "New", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", canceled: "Canceled" };
const STORAGE_KEY = "aeroleadai_contractor_code";

// Contractor portal: accept/decline job offers, review the AI estimate +
// annotated damage imagery, and mark work complete. Auth here is a real but
// intentionally minimal gate — a per-contractor unguessable code
// (contractors.portal_access_code) cached in localStorage after first
// entry, same honest-placeholder pattern noted in README; swap for real
// Supabase Auth before this touches contractors you don't personally vouch for.
export default function ContractorPortal() {
  const [code, setCode] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const [contractor, setContractor] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [performance, setPerformance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyJobId, setBusyJobId] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("code");
    const fromStorage = localStorage.getItem(STORAGE_KEY);
    const c = fromUrl || fromStorage;
    if (c) setCode(c);
  }, []);

  async function load(c) {
    setLoading(true);
    setError("");
    try {
      const [jobsRes, perfRes] = await Promise.all([
        fetch(`/api/contractor/jobs?code=${encodeURIComponent(c)}`).then((r) => r.json()),
        fetch(`/api/contractor/performance?code=${encodeURIComponent(c)}`).then((r) => r.json()),
      ]);
      if (jobsRes.error) throw new Error(jobsRes.error);
      setContractor(jobsRes.contractor);
      setJobs(jobsRes.jobs || []);
      setPerformance(perfRes.error ? null : perfRes);
      localStorage.setItem(STORAGE_KEY, c);
    } catch (e) {
      setError(e.message || "Could not load your jobs.");
      setContractor(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (code) load(code); }, [code]);

  async function act(jobId, action) {
    setBusyJobId(jobId);
    try {
      const res = await fetch(`/api/contractor/jobs/${jobId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, action }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJobs((prev) => prev.map((j) => (j.id === jobId ? data.job : j)));
    } catch (e) {
      setError(e.message || "Action failed.");
    } finally {
      setBusyJobId(null);
    }
  }

  function submitCode(e) {
    e.preventDefault();
    if (codeInput.trim()) setCode(codeInput.trim());
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY);
    setCode(null);
    setContractor(null);
    setJobs([]);
  }

  const wrap = { minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif" };

  if (!code || (!loading && !contractor && error)) {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <form onSubmit={submitCode} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 24, width: 320 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace", marginBottom: 8 }}>AEROLEADAI</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Contractor Portal</div>
          <div style={{ fontSize: 13, color: MUTE, marginBottom: 16 }}>Enter the access code from your onboarding email.</div>
          {error && <div style={{ color: RED, fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <input
            value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Access code"
            style={{ width: "100%", background: PANEL2, border: `1px solid ${LINE}`, borderRadius: 8, padding: 10, color: TEXT, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
          />
          <button type="submit" style={{ width: "100%", background: AMBER, color: "#0d1420", border: "none", borderRadius: 8, padding: 10, fontWeight: 700, cursor: "pointer" }}>
            Sign in
          </button>
        </form>
      </div>
    );
  }

  if (loading && !contractor) {
    return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", color: MUTE }}>Loading…</div>;
  }

  return (
    <div style={{ ...wrap, padding: "24px 20px", maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI · CONTRACTOR</div>
          <h1 style={{ fontSize: 22, margin: "4px 0" }}>{contractor?.name || "Contractor"}</h1>
        </div>
        <button onClick={signOut} style={{ background: "none", border: `1px solid ${LINE}`, color: MUTE, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Sign out</button>
      </div>

      {performance && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
          {[
            ["Performance", performance.performance_score != null ? performance.performance_score : "—"],
            ["Acceptance", performance.acceptance_rate != null ? `${Math.round(performance.acceptance_rate * 100)}%` : "—"],
            ["Completion", performance.completion_rate != null ? `${Math.round(performance.completion_rate * 100)}%` : "—"],
            ["Avg turnaround", performance.avg_turnaround_days != null ? `${performance.avg_turnaround_days.toFixed(1)}d` : "—"],
          ].map(([label, value]) => (
            <div key={label} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 10, color: MUTE, textTransform: "uppercase" }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: RED, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {jobs.length === 0 && <div style={{ color: MUTE, fontSize: 13 }}>No jobs assigned yet.</div>}

      {jobs.map((job) => (
        <div key={job.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{job.address}</div>
              <div style={{ fontSize: 12, color: MUTE }}>
                Status: <span style={{ color: TEXT }}>{STATUS_LABEL[job.status] || job.status}</span>
                {job.contractor_response ? ` · Your response: ${job.contractor_response}` : ""}
                {job.scheduled_date ? ` · Scheduled: ${new Date(job.scheduled_date).toLocaleString()}` : ""}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: MUTE }}>Estimate</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: GREEN }}>{job.revenue_estimate ? `$${Number(job.revenue_estimate).toLocaleString()}` : "—"}</div>
            </div>
          </div>

          {job.ai_findings?.imageUrl && (
            <div style={{ marginTop: 10, marginBottom: 10 }}>
              <RoofAnnotationViewer imageUrl={job.ai_findings.imageUrl} damage={job.ai_findings.damage} confidence={job.ai_findings.overall_confidence} />
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {!job.contractor_response && (
              <>
                <button disabled={busyJobId === job.id} onClick={() => act(job.id, "accept")}
                  style={{ background: GREEN, color: "#0d1420", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
                  Accept
                </button>
                <button disabled={busyJobId === job.id} onClick={() => act(job.id, "decline")}
                  style={{ background: "none", color: RED, border: `1px solid ${RED}`, borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
                  Decline
                </button>
              </>
            )}
            {job.contractor_response === "accepted" && job.status !== "completed" && (
              <button disabled={busyJobId === job.id} onClick={() => act(job.id, "complete")}
                style={{ background: BLUE, color: "#0d1420", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
                Mark complete
              </button>
            )}
            {job.status === "completed" && <span style={{ color: GREEN, fontSize: 13, alignSelf: "center" }}>✓ Completed</span>}
            {job.contractor_response === "declined" && <span style={{ color: MUTE, fontSize: 13, alignSelf: "center" }}>Declined</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
