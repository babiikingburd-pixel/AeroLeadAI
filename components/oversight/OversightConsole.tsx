"use client";
import { useMemo, useState } from "react";

const realityLabel: Record<string, string> = { REAL_NOW: "LIVE", CACHED_REAL: "CACHED", UNAVAILABLE: "OFFLINE", UNKNOWN: "UNKNOWN" };
const scoreTone = (score: number) => score >= 75 ? "hot" : score >= 45 ? "warm" : "cool";
const clamp = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export default function OversightConsole({ initial }: { initial: any }) {
  const [selectedId, setSelectedId] = useState(initial.profiles[0]?.parcel_id || null);
  const [mode, setMode] = useState<"TOP_20" | "TOP_100" | "TOP_500" | "ALL">("TOP_20");
  const [openEvidence, setOpenEvidence] = useState<any | null>(null);

  const profiles = useMemo(() => {
    const ranked = [...initial.profiles].sort((a: any, b: any) => Number(a.live_rank ?? 999999) - Number(b.live_rank ?? 999999) || Number(b.rank_score ?? 0) - Number(a.rank_score ?? 0));
    if (mode === "TOP_20") return ranked.filter((p: any) => Number(p.live_rank) > 0 && Number(p.live_rank) <= 20);
    if (mode === "TOP_100") return ranked.filter((p: any) => Number(p.live_rank) > 0 && Number(p.live_rank) <= 100);
    if (mode === "TOP_500") return ranked.slice(0, 500);
    return ranked;
  }, [initial.profiles, mode]);

  const active = initial.profiles.find((p: any) => p.parcel_id === selectedId) || profiles[0] || null;
  const evidence = initial.evidence.filter((e: any) => e.parcel_id === active?.parcel_id);
  const type = (name: string) => evidence.filter((e: any) => e.type === name);
  const liveCount = initial.evidence.filter((e: any) => e.reality === "REAL_NOW" || e.reality === "CACHED_REAL").length;
  const verified = initial.profiles.filter((p: any) => p.gate_allowed).length;
  const ring = initial.rings.find((r: any) => r.active) || initial.rings[0];
  const audit = active ? initial.audits?.[active.parcel_id] : null;
  const doctorComplete = Object.values(initial.audits || {}).filter((item: any) => item.complete).length;
  const thingsToInspect = inspectionList(active, audit, evidence);

  return <main className="ov-shell">
    <div className="ov-grid" /><div className="ov-vignette" />
    <header className="ov-top glass">
      <div className="ov-brand"><span className="ov-mark" />AEROLEAD <b>OVERSIGHT</b><small>PROPERTY EVIDENCE COMMAND</small></div>
      <div className="ov-mission"><span>MISSION</span> Evidence first · every score inspectable</div>
      <div className="ov-health"><i className={initial.connectionError ? "bad" : "good"} />{initial.connectionError ? "DATA LINK DEGRADED" : "AUTONOMOUS SYSTEM ONLINE"}</div>
    </header>

    <section className="ov-stats">
      <Stat label="Profiles" value={initial.profiles.length} />
      <Stat label="Verified" value={verified} tone="green" />
      <Stat label="Real evidence" value={liveCount} tone="cyan" />
      <Stat label="Doctor complete" value={`${doctorComplete}/${initial.profiles.length}`} tone="amber" />
      <Stat label="Active ring" value={ring?.ring_id || "—"} sub={ring ? `${Math.round(Number(ring.completion_pct))}% complete` : "awaiting seed"} />
    </section>

    <section className="ov-deck">
      <aside className="ov-queue glass">
        <div className="panel-head"><span>Ranked property deck</span><b>{profiles.length}</b></div>
        <div className="mode-tabs four">
          {(["TOP_20","TOP_100","TOP_500","ALL"] as const).map(x => <button key={x} className={mode === x ? "active" : ""} onClick={() => setMode(x)}>{x.replace("_", " ")}</button>)}
        </div>
        <div className="queue-scroll">
          {!profiles.length && <Empty text="No fabricated leads. Properties appear only from collected evidence." />}
          {profiles.map((p: any, index: number) => <button className={`lead-row ${active?.parcel_id === p.parcel_id ? "selected" : ""}`} onClick={() => setSelectedId(p.parcel_id)} key={p.parcel_id}>
            <span className={`rank ${scoreTone(Number(p.rank_score ?? p.opportunity))}`}>{String(Number(p.live_rank || index + 1)).padStart(2,"0")}</span>
            <span className="lead-copy"><b>{p.address}</b><small>{p.doctor_gate_status || p.state?.replaceAll("_", " ")} · {Math.round(Number(p.evidence_confidence) * 100)}% confidence</small></span>
            <strong title="Live rank score">{Math.round(Number(p.rank_score ?? p.opportunity ?? 0))}</strong>
          </button>)}
        </div>
      </aside>

      <section className="ov-focus glass">
        <div className="focus-head">
          <div><small>ACTIVE PROPERTY · CLICK EVIDENCE TO TRACE SOURCE</small><h1>{active?.address || "Awaiting verified property"}</h1><p>{active ? `${active.parcel_id} · ${active.zip || "ZIP pending"} · live rank #${active.live_rank || "—"}` : "The pipeline is ready; no sample property has been inserted."}</p></div>
          <div className={`gate-badge ${active?.doctor_gate_status === "CERTIFIED" || active?.gate_allowed ? "pass" : active?.doctor_gate_status === "ELIGIBLE" ? "review" : "hold"}`}><small>DOCTOR GATEKEEPER</small>{active?.doctor_gate_status || (active?.gate_allowed ? "VERIFIED" : "HOLD")}</div>
        </div>

        <ScoreBoard profile={active} audit={audit} />

        <div className="instrument-layer">
          <Instrument title="Imagery" className="imagery" records={type("IMAGERY")} accent="cyan" address={active?.address} onOpen={setOpenEvidence} />
          <Instrument title="Permits" className="permits" records={type("PERMIT")} accent="green" address={active?.address} onOpen={setOpenEvidence} />
          <Instrument title="Storm history" className="weather" records={type("WEATHER")} accent="amber" address={active?.address} onOpen={setOpenEvidence} />
          <Instrument title="Structure" className="structure" records={type("STRUCTURE")} accent="violet" address={active?.address} onOpen={setOpenEvidence} />
          {!active && <div className="empty-center">NO PLACEHOLDER TARGET<br/><small>real evidence will populate this helm</small></div>}
        </div>
      </section>

      <aside className="ov-intel glass">
        <div className="panel-head"><span>Evidence graph</span><b>{evidence.length}</b></div>
        <Gauge value={Number(active?.evidence_confidence || 0)} />
        <div className="evidence-list">
          {["IMAGERY","PERMIT","WEATHER","STRUCTURE","PROPERTY"].map(t => { const r=type(t)[0]; return <button className="evidence-line evidence-button" key={t} disabled={!r} onClick={() => r && setOpenEvidence(r)}><i className={r ? r.reality === "UNAVAILABLE" ? "bad" : "good" : "idle"}/><span><b>{t}</b><small>{r ? `${r.provider} · ${realityLabel[r.reality] || r.reality} · open source` : "not collected"}</small></span></button> })}
        </div>
        <InspectionPanel items={thingsToInspect} />
        <DoctorPanel audit={audit} />
      </aside>
    </section>

    <footer className="ov-telemetry glass"><span><i className="good"/> EVIDENCE CACHE PERSISTENT</span><span><i className="good"/> RLS ENFORCED</span><span><i className={initial.connectionError ? "bad" : "good"}/> SUPABASE {initial.connectionError ? "DEGRADED" : "CONNECTED"}</span><span className="push">SCORE ≠ CLAIM · OPEN EVERY SOURCE</span></footer>
    {openEvidence && <EvidenceDrawer record={openEvidence} onClose={() => setOpenEvidence(null)} />}
  </main>
}

function Stat({label,value,tone="",sub}:{label:string,value:any,tone?:string,sub?:string}) { return <div className={`ov-stat glass ${tone}`}><small>{label}</small><b>{value}</b>{sub && <em>{sub}</em>}</div> }
function Empty({text}:{text:string}) { return <div className="empty-queue">{text}</div> }

function ScoreBoard({profile,audit}:{profile:any,audit:any}) {
  const rank = clamp(Number(profile?.rank_score ?? 0));
  const opportunity = clamp(Number(profile?.opportunity ?? 0));
  const confidence = clamp(Number(profile?.evidence_confidence ?? 0) * 100);
  const completion = clamp(Number(audit?.completionPct ?? profile?.doctor_completion_pct ?? profile?.completion_pct ?? 0));
  return <div className="score-board">
    <div className="score-primary"><small>LIVE EVIDENCE SCORE</small><b>{Math.round(rank)}<em>/100</em></b><span>Rank #{profile?.live_rank || "—"}</span></div>
    <ScoreMetric label="Opportunity" value={opportunity} />
    <ScoreMetric label="Confidence" value={confidence} />
    <ScoreMetric label="Doctor" value={completion} />
  </div>
}
function ScoreMetric({label,value}:{label:string,value:number}) { return <div className="score-metric"><span><small>{label}</small><b>{Math.round(value)}</b></span><i><em style={{width:`${clamp(value)}%`}} /></i></div> }

function Instrument({title,records,className,accent,address,onOpen}:{title:string,records:any[],className:string,accent:string,address?:string,onOpen:(r:any)=>void}) {
  const r=records[0]; const imageUrl=r?.payload?.image_url;
  return <article className={`instrument ${className} ${accent} ${r ? "present" : "standby"}`}>
    <header><span>{title}</span><b>{r ? realityLabel[r.reality] || r.reality : "STANDBY"}</b></header>
    <button className="instrument-open" disabled={!r} onClick={() => r && onOpen(r)}>
      {r ? <>{imageUrl && <div className="instrument-image"><img src={imageUrl} alt={`Satellite view centered on ${address || r.parcel_id}`} /><span className="target-crosshair" aria-hidden="true"><i/><b/></span><label>{address || r.parcel_id}<small>TARGET ADDRESS POINT · OPEN FOR SOURCE</small></label></div>}<strong>{r.provider}</strong><p>{r.effective_at ? new Date(r.effective_at).toLocaleDateString() : r.payload?.capture_date || "Capture date pending"}</p><small>{Math.round(Number(r.confidence)*100)}% source confidence · click for provenance</small></> : <><strong>NO RECORD</strong><p>Provider will retry autonomously</p></>}
    </button>
  </article>
}

function Gauge({value}:{value:number}) { const pct=Math.round(value*100); return <div className="gauge-wrap"><div className="gauge" style={{background:`conic-gradient(#5fe0ff ${pct*3.6}deg, rgba(255,255,255,.06) 0)`}}><span>{pct}<small>%</small></span></div><p>EVIDENCE CONFIDENCE</p></div> }

function inspectionList(profile:any,audit:any,evidence:any[]) {
  const items:string[] = [];
  if (audit?.nextAction?.label) items.push(`${audit.nextAction.label}: ${audit.nextAction.repairAction}`);
  const imagery = evidence.find((r:any)=>r.type === "IMAGERY");
  const weather = evidence.find((r:any)=>r.type === "WEATHER");
  const permit = evidence.find((r:any)=>r.type === "PERMIT");
  if (imagery && !imagery.payload?.capture_date && !imagery.effective_at) items.push("Confirm imagery capture date before treating visual condition as current.");
  if (imagery && !["complete","completed","analyzed","reviewed"].includes(String(imagery.payload?.damage_analysis_status || imagery.payload?.analysis_status || "").toLowerCase())) items.push("Roof image still needs visual analysis; inspect shingles, staining, patching and tree impact.");
  if (!weather) items.push("Storm history is still missing; hail/wind exposure can materially change the ranking.");
  if (permit?.payload?.search_result === "no_matching_roofing_permits") items.push("No matching roofing permit found; treat as negative evidence only, not proof of an old roof.");
  if (!profile?.zip) items.push("ZIP/identity corroboration is incomplete; keep the property in Doctor repair.");
  return items.slice(0,5);
}
function InspectionPanel({items}:{items:string[]}) { return <section className="inspection-panel"><header>THINGS TO LOOK AT</header>{items.length ? items.map((x,i)=><p key={`${i}-${x}`}>→ {x}</p>) : <p>→ No unresolved inspection item surfaced from current evidence.</p>}</section> }

function DoctorPanel({audit}:{audit:any}) { if (!audit) return null; return <section className="doctor-panel"><header><span>DOCTOR SELF-AUDIT</span><b className={audit.complete ? "done" : "working"}>{audit.completeCount}/{audit.requiredCount}</b></header><div className="doctor-checks">{audit.checklist.map((check:any)=><div key={check.key} className={`doctor-check ${check.status.toLowerCase()}`}><i>{check.complete ? "✓" : check.status === "READY" ? "→" : "·"}</i><span><b>{check.label}</b><small>{check.complete ? check.evidenceProvider || "verified" : check.status === "READY" ? check.repairAction : `Waiting for ${check.provider}`}</small></span></div>)}</div>{audit.nextAction && <footer><small>NEXT REPAIR</small><b>{audit.nextAction.label}</b><p>{audit.nextAction.repairAction}</p></footer>}</section> }

function EvidenceDrawer({record,onClose}:{record:any,onClose:()=>void}) {
  const payloadEntries = Object.entries(record.payload || {}).filter(([,value]) => value !== null && value !== "" && typeof value !== "object").slice(0,18);
  return <div className="evidence-overlay" onMouseDown={onClose}><section className="evidence-drawer glass" onMouseDown={e=>e.stopPropagation()}>
    <header><div><small>EVIDENCE PROVENANCE</small><h2>{record.type} · {record.provider}</h2></div><button onClick={onClose}>×</button></header>
    <div className="evidence-meta"><span><small>REALITY</small><b>{record.reality}</b></span><span><small>CONFIDENCE</small><b>{Math.round(Number(record.confidence || 0)*100)}%</b></span><span><small>CAPTURED</small><b>{record.captured_at ? new Date(record.captured_at).toLocaleString() : "—"}</b></span></div>
    {record.payload?.image_url && <div className="drawer-image"><img src={record.payload.image_url} alt={`Evidence for ${record.parcel_id}`} /><span className="target-crosshair large"><i/><b/></span></div>}
    <div className="source-block"><small>SOURCE REFERENCE</small>{record.source_ref ? <a href={record.source_ref} target="_blank" rel="noreferrer">Open original provider/source ↗</a> : <b>No external source URL recorded</b>}</div>
    <div className="payload-grid">{payloadEntries.map(([key,value])=><div key={key}><small>{key.replaceAll("_"," ")}</small><b>{String(value)}</b></div>)}</div>
    <footer>This panel shows the evidence record used by Oversight. The center marker identifies the stored address/coordinate target; it is not a surveyed parcel-boundary overlay.</footer>
  </section></div>
}
