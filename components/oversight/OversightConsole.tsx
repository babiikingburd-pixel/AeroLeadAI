"use client";
import { useMemo, useState } from "react";

const realityLabel: Record<string, string> = { REAL_NOW: "LIVE", CACHED_REAL: "CACHED", UNAVAILABLE: "OFFLINE", UNKNOWN: "UNKNOWN" };
const scoreTone = (score: number) => score >= 75 ? "hot" : score >= 45 ? "warm" : "cool";

export default function OversightConsole({ initial }: { initial: any }) {
  const [selectedId, setSelectedId] = useState(initial.profiles[0]?.parcel_id || null);
  const [mode, setMode] = useState<"TOP_100" | "TOP_500" | "ALL">("TOP_100");
  const profiles = useMemo(() => initial.profiles.filter((p: any) => mode === "ALL" || p.deep_dive_tier === mode || (mode === "TOP_500" && p.deep_dive_tier === "TOP_100")), [initial.profiles, mode]);
  const active = initial.profiles.find((p: any) => p.parcel_id === selectedId) || profiles[0] || null;
  const evidence = initial.evidence.filter((e: any) => e.parcel_id === active?.parcel_id);
  const type = (name: string) => evidence.filter((e: any) => e.type === name);
  const liveCount = initial.evidence.filter((e: any) => e.reality === "REAL_NOW" || e.reality === "CACHED_REAL").length;
  const verified = initial.profiles.filter((p: any) => p.gate_allowed).length;
  const review = initial.profiles.filter((p: any) => p.state === "REVIEW_REQUIRED").length;
  const ring = initial.rings.find((r: any) => r.active) || initial.rings[0];

  return <main className="ov-shell">
    <div className="ov-grid" /><div className="ov-vignette" />
    <header className="ov-top glass">
      <div className="ov-brand"><span className="ov-mark" />AEROLEAD <b>OVERSIGHT</b><small>PROPERTY EVIDENCE COMMAND</small></div>
      <div className="ov-mission"><span>MISSION</span> Exhaust 55431 · verify before promotion</div>
      <div className="ov-health"><i className={initial.connectionError ? "bad" : "good"} />{initial.connectionError ? "DATA LINK DEGRADED" : "AUTONOMOUS SYSTEM ONLINE"}</div>
    </header>

    <section className="ov-stats">
      <Stat label="Profiles" value={initial.profiles.length} />
      <Stat label="Verified" value={verified} tone="green" />
      <Stat label="Real evidence" value={liveCount} tone="cyan" />
      <Stat label="Human review" value={review} tone="amber" />
      <Stat label="Active ring" value={ring?.ring_id || "—"} sub={ring ? `${Math.round(Number(ring.completion_pct))}% complete` : "awaiting seed"} />
    </section>

    <section className="ov-deck">
      <aside className="ov-queue glass">
        <div className="panel-head"><span>Priority flight deck</span><b>{profiles.length}</b></div>
        <div className="mode-tabs">
          {(["TOP_100","TOP_500","ALL"] as const).map(x => <button key={x} className={mode === x ? "active" : ""} onClick={() => setMode(x)}>{x.replace("_", " ")}</button>)}
        </div>
        <div className="queue-scroll">
          {!profiles.length && <Empty text="No fabricated leads. Profiles appear after real evidence is processed." />}
          {profiles.map((p: any, index: number) => <button className={`lead-row ${active?.parcel_id === p.parcel_id ? "selected" : ""}`} onClick={() => setSelectedId(p.parcel_id)} key={p.parcel_id}>
            <span className={`rank ${scoreTone(Number(p.opportunity))}`}>{String(index + 1).padStart(2,"0")}</span>
            <span className="lead-copy"><b>{p.address}</b><small>{p.state?.replaceAll("_", " ")} · {Math.round(Number(p.evidence_confidence) * 100)}% confidence</small></span>
            <strong>{Math.round(Number(p.opportunity))}</strong>
          </button>)}
        </div>
      </aside>

      <section className="ov-focus glass">
        <div className="focus-head">
          <div><small>ACTIVE PROPERTY</small><h1>{active?.address || "Awaiting verified property"}</h1><p>{active ? `${active.parcel_id} · ${active.zip || "ZIP pending"}` : "The pipeline is ready; no sample property has been inserted."}</p></div>
          <div className={`gate-badge ${active?.gate_allowed ? "pass" : active?.state === "REVIEW_REQUIRED" ? "review" : "hold"}`}><small>GATEKEEPER</small>{active?.gate_allowed ? "VERIFIED" : active?.state === "REVIEW_REQUIRED" ? "REVIEW" : "HOLD"}</div>
        </div>
        <div className="threat-strip"><span style={{width:`${Math.max(0, Math.min(100, Number(active?.opportunity || 0)))}%`}} /><label>OPPORTUNITY {Math.round(Number(active?.opportunity || 0))}/100</label></div>

        <div className="instrument-layer">
          <Instrument title="Imagery" className="imagery" records={type("IMAGERY")} accent="cyan" />
          <Instrument title="Permits" className="permits" records={type("PERMIT")} accent="green" />
          <Instrument title="Storm history" className="weather" records={type("WEATHER")} accent="amber" />
          <Instrument title="Structure" className="structure" records={type("STRUCTURE")} accent="violet" />
          {!active && <div className="empty-center">NO PLACEHOLDER TARGET<br/><small>real evidence will populate this helm</small></div>}
        </div>
      </section>

      <aside className="ov-intel glass">
        <div className="panel-head"><span>Evidence graph</span><b>{evidence.length}</b></div>
        <Gauge value={Number(active?.evidence_confidence || 0)} />
        <div className="evidence-list">
          {["IMAGERY","PERMIT","WEATHER","STRUCTURE"].map(t => { const r=type(t)[0]; return <div className="evidence-line" key={t}><i className={r ? r.reality === "UNAVAILABLE" ? "bad" : "good" : "idle"}/><span><b>{t}</b><small>{r ? `${r.provider} · ${realityLabel[r.reality] || r.reality}` : "not collected"}</small></span></div> })}
        </div>
        <div className="decision-log"><small>DECISION BASIS</small>{(active?.gate_reasons || []).map((x:string)=><p key={x}>→ {x}</p>)}{!(active?.gate_reasons || []).length && <p>→ Awaiting evidence</p>}</div>
      </aside>
    </section>

    <footer className="ov-telemetry glass"><span><i className="good"/> EVIDENCE CACHE PERSISTENT</span><span><i className="good"/> RLS ENFORCED</span><span><i className={initial.connectionError ? "bad" : "good"}/> SUPABASE {initial.connectionError ? "DEGRADED" : "CONNECTED"}</span><span className="push">UNKNOWN ≠ ZERO · NO EVIDENCE ≠ NO DAMAGE</span></footer>
  </main>
}

function Stat({label,value,tone="",sub}:{label:string,value:any,tone?:string,sub?:string}) { return <div className={`ov-stat glass ${tone}`}><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div> }
function Empty({text}:{text:string}) { return <div className="empty-queue">{text}</div> }
function Instrument({title,records,className,accent}:{title:string,records:any[],className:string,accent:string}) { const r=records[0]; return <article className={`instrument ${className} ${accent} ${r ? "present" : "standby"}`}><header><span>{title}</span><b>{r ? realityLabel[r.reality] || r.reality : "STANDBY"}</b></header><div>{r ? <><strong>{r.provider}</strong><p>{r.effective_at ? new Date(r.effective_at).toLocaleDateString() : "Current capture"}</p><small>{Math.round(Number(r.confidence)*100)}% source confidence</small></> : <><strong>NO RECORD</strong><p>Provider will retry autonomously</p></>}</div></article> }
function Gauge({value}:{value:number}) { const pct=Math.round(value*100); return <div className="gauge-wrap"><div className="gauge" style={{background:`conic-gradient(#5fe0ff ${pct*3.6}deg, rgba(255,255,255,.06) 0)`}}><span>{pct}<small>%</small></span></div><p>EVIDENCE CONFIDENCE</p></div> }
