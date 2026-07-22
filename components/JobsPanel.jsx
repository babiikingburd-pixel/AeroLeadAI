"use client";
import { useEffect, useState } from "react";
import { subscribe, pauseJob, resumeJob, removeJob, retryFailedItems, requestNotifyPermission, runQueue } from "../lib/jobQueue";

const AMBER = "#f5a623", PANEL = "#141b26", LINE = "#232f3e", MUTE = "#6b7c93", GREEN = "#4caf7d", RED = "#e5534b", BLUE = "#2e7dd1";
const STATUS_COLOR = { queued: MUTE, running: BLUE, paused: AMBER, done: GREEN, failed: RED };

// Background Processing Engine: every job queued by Discovery, Batch, or the
// Scanner shows up here with live progress, can be paused/resumed, retried
// on failure, and resumes automatically if the tab was closed mid-run
// (state is persisted, not in-memory only).
export default function JobsPanel() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    requestNotifyPermission();
    const unsub = subscribe((state) => setJobs(state.jobs));
    return unsub;
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20, fontFamily: "Inter, system-ui, sans-serif", color: "#dfe6ee" }}>
      <div style={{ fontSize: 12, fontFamily: "monospace", color: AMBER, marginBottom: 12 }}>BACKGROUND PROCESSING ENGINE</div>

      {jobs.length === 0 && (
        <div style={{ fontSize: 13, color: MUTE }}>No jobs yet. Queue work from <a href="/discovery" style={{ color: BLUE }}>Discovery</a> or the Batch pipeline and it'll show up here with live progress — jobs resume automatically if you close the tab mid-run.</div>
      )}

      {jobs.map((job) => {
        const done = job.items.filter((i) => i.status === "done").length;
        const failed = job.items.filter((i) => i.status === "failed").length;
        const total = job.items.length;
        const pct = total ? Math.round(((done + failed) / total) * 100) : 0;
        return (
          <div key={job.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{job.label}</div>
                <div style={{ fontSize: 11, color: STATUS_COLOR[job.status], textTransform: "uppercase", fontWeight: 700 }}>{job.status}</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {job.status === "running" || job.status === "queued" ? (
                  <button onClick={() => pauseJob(job.id)} style={{ padding: "5px 10px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: AMBER, cursor: "pointer", fontSize: 12 }}>Pause</button>
                ) : job.status === "paused" ? (
                  <button onClick={() => { resumeJob(job.id); }} style={{ padding: "5px 10px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: GREEN, cursor: "pointer", fontSize: 12 }}>Resume</button>
                ) : null}
                {failed > 0 && <button onClick={() => retryFailedItems(job.id)} style={{ padding: "5px 10px", background: "transparent", border: `1px solid ${RED}`, borderRadius: 6, color: RED, cursor: "pointer", fontSize: 12 }}>Retry failed ({failed})</button>}
                <button onClick={() => removeJob(job.id)} style={{ padding: "5px 10px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: MUTE, cursor: "pointer", fontSize: 12 }}>Remove</button>
              </div>
            </div>
            <div style={{ height: 8, background: "#0b0f16", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: failed > done ? RED : GREEN, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontSize: 12, color: MUTE }}>{done}/{total} done{failed ? `, ${failed} failed` : ""} · created {new Date(job.createdAt).toLocaleString()}</div>
          </div>
        );
      })}
    </div>
  );
}
