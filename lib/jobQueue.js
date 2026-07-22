"use client";
// Background Processing Engine: a generic, persisted job queue used by
// Discovery, the Background Scanner, and batch report generation. Jobs
// survive a page reload (state lives in localStorage), retry automatically
// on failure (bounded backoff), report progress, and can notify the user via
// the browser Notification API when a run finishes.
const KEY = "aeroleadai_jobqueue_v1";
const MAX_RETRIES = 2;
const listeners = new Set();

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{"jobs":[]}'); } catch { return { jobs: [] }; } }
function save(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} emit(); return state; }
function emit() { listeners.forEach((fn) => fn(load())); }

export function subscribe(fn) { listeners.add(fn); fn(load()); return () => listeners.delete(fn); }
export function getJobs() { return load().jobs; }

// Create a job: { id, type, label, items: [...], handler is NOT persisted
// (functions can't survive localStorage) — the runner below looks up the
// handler by `type` from a registry the caller provides.
export function enqueueJob({ type, label, items }) {
  const state = load();
  const job = {
    id: Math.random().toString(36).slice(2),
    type, label,
    items: items.map((it) => ({ payload: it, status: "queued", attempts: 0, error: null })),
    status: "queued", // queued | running | paused | done | failed
    createdAt: new Date().toISOString(),
    notifyOnComplete: true,
  };
  state.jobs.unshift(job);
  save(state);
  return job.id;
}

export function pauseJob(id) { patchJob(id, { status: "paused" }); }
export function resumeJob(id) { patchJob(id, { status: "queued" }); }
export function removeJob(id) { const s = load(); s.jobs = s.jobs.filter((j) => j.id !== id); save(s); }
export function retryFailedItems(id) {
  const s = load();
  const job = s.jobs.find((j) => j.id === id);
  if (!job) return;
  job.items.forEach((it) => { if (it.status === "failed") { it.status = "queued"; it.attempts = 0; it.error = null; } });
  job.status = "queued";
  save(s);
}

function patchJob(id, patch) {
  const s = load();
  const job = s.jobs.find((j) => j.id === id);
  if (job) Object.assign(job, patch);
  save(s);
}

function notify(title, body) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") new Notification(title, { body });
  } catch {}
}

export async function requestNotifyPermission() {
  try { if (typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission(); } catch {}
}

// The runner: pass a registry of { [type]: async (payload) => resultPatch }
// handlers. Call run() once per session (e.g. app mount) — it resumes any
// queued/running jobs left over from a previous session automatically.
let runnerActive = false;
export async function runQueue(handlers, { pace = 900 } = {}) {
  if (runnerActive) return;
  runnerActive = true;
  try {
    while (true) {
      const s = load();
      const job = s.jobs.find((j) => j.status === "queued" || j.status === "running");
      if (!job) break;
      job.status = "running";
      save(s);

      const item = job.items.find((it) => it.status === "queued" || it.status === "retrying");
      if (!item) {
        job.status = job.items.some((it) => it.status === "failed") ? "failed" : "done";
        save(s);
        if (job.notifyOnComplete) notify("AeroLeadAI", `${job.label} finished — ${job.items.filter((i) => i.status === "done").length}/${job.items.length} succeeded.`);
        continue;
      }

      const handler = handlers[job.type];
      if (!handler) { item.status = "failed"; item.error = "No handler registered for job type " + job.type; save(s); continue; }

      try {
        const result = await handler(item.payload);
        item.status = "done"; item.result = result;
      } catch (e) {
        item.attempts += 1;
        if (item.attempts <= MAX_RETRIES) { item.status = "retrying"; item.error = e.message; }
        else { item.status = "failed"; item.error = e.message; }
      }
      save(s);
      // Re-check pause state before continuing (allows mid-run pause)
      const fresh = load().jobs.find((j) => j.id === job.id);
      if (fresh?.status === "paused") continue;
      await new Promise((r) => setTimeout(r, pace));
    }
  } finally {
    runnerActive = false;
  }
}
