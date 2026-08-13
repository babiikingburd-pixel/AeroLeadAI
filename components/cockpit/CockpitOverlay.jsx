"use client";
import { useEffect, useMemo, useRef, useState } from "react";

const MODULES = [
  ["⌂", "Command", "/"], ["◎", "Discovery", "/discovery"], ["◈", "Lead Map", "/map"],
  ["△", "Top 10", "/apex-roofing"], ["⚡", "Scanner", "/scanner"], ["▦", "CRM", "/crm"],
  ["◫", "Ops", "/ops"], ["◉", "Intelligence", "/intelligence"], ["✦", "Executive", "/executive"]
];

function DraggablePanel({ id, title, kicker, children, initial }) {
  const [pos, setPos] = useState(initial);
  const drag = useRef(null);
  const onPointerDown = (e) => {
    if (e.target.closest("button,a,input")) return;
    drag.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos({ left: drag.current.left + e.clientX - drag.current.x, top: drag.current.top + e.clientY - drag.current.y });
  };
  const stop = () => { drag.current = null; };
  return <section id={id} className="cockpit-panel" style={{ left: pos.left, top: pos.top }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={stop} onPointerCancel={stop}>
    <header className="cockpit-panel-head"><div><div className="cockpit-kicker">{kicker}</div><h3>{title}</h3></div><span className="drag-handle">⠿</span></header>
    <div className="cockpit-panel-body">{children}</div>
  </section>;
}

export default function CockpitOverlay() {
  const [top10, setTop10] = useState([]);
  const [clock, setClock] = useState(new Date());
  const [mode, setMode] = useState("TACTICAL");
  const [pulse, setPulse] = useState(true);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    fetch("/api/opportunities/top10").then(r => r.ok ? r.json() : null).then(d => setTop10(d?.opportunities || [])).catch(() => {});
    return () => clearInterval(t);
  }, []);

  const hot = useMemo(() => top10.filter(x => Number(x.opportunity_score) >= 75).length, [top10]);
  return <div className="cockpit-root">
    <div className="cockpit-vignette" />
    <div className="cockpit-grid" />
    <div className="cockpit-scan" />

    <header className="cockpit-topbar glass">
      <div className="brand-mark"><span className="brand-orb" /> AEROLEAD<span>AI</span></div>
      <div className="flight-status"><i /> GATEKEEPER LINKED <b>•</b> EVIDENCE MODE</div>
      <div className="top-actions"><button onClick={() => setPulse(v => !v)}>{pulse ? "◉ LIVE" : "○ PAUSED"}</button><span>{clock.toLocaleTimeString([], {hour12:false})}</span></div>
    </header>

    <aside className="cockpit-rail glass">
      <div className="rail-label">FLIGHT DECK</div>
      {MODULES.map(([icon,label,href]) => <a key={href} href={href} title={label}><span>{icon}</span><small>{label}</small></a>)}
    </aside>

    <div className="cockpit-mode glass">
      {['TACTICAL','EVIDENCE','REVENUE'].map(x => <button key={x} className={mode===x?'active':''} onClick={() => setMode(x)}>{x}</button>)}
    </div>

    <DraggablePanel id="apex-priority" title="APEX ROOFING" kicker="PRIORITY CONTRACTOR // #01" initial={{left:24,top:84}}>
      <div className="priority-title"><span className="pulse-dot" /> ACTIVE ROUTE</div>
      <div className="priority-copy">Properties are ranked by evidence. Apex Roofing receives the #1 contractor route without overriding property-level scoring.</div>
      <div className="metric-row"><div><b>{top10.length || "—"}</b><span>TOP 10</span></div><div><b>{hot || "—"}</b><span>HOT</span></div><div><b>01</b><span>ROUTE</span></div></div>
      <a className="glass-button" href="/apex-roofing">OPEN APEX COMMAND →</a>
    </DraggablePanel>

    <DraggablePanel id="top10-panel" title="OPPORTUNITY RADAR" kicker="LIVE PROPERTY INTELLIGENCE" initial={{right:24,top:84}}>
      <div className="radar"><div className="radar-ring r1"/><div className="radar-ring r2"/><div className="radar-sweep"/><span className="radar-blip b1"/><span className="radar-blip b2"/><span className="radar-blip b3"/></div>
      <div className="top-list">{top10.slice(0,5).map((o,i)=><a href="/apex-roofing" key={o.id || i}><span>0{i+1}</span><strong>{o.address || "Opportunity"}</strong><em>{o.opportunity_score ?? "—"}</em></a>)}{!top10.length && <div className="empty">Waiting for live opportunity feed…</div>}</div>
    </DraggablePanel>

    <DraggablePanel id="system-panel" title="SYSTEM TELEMETRY" kicker="COCKPIT INSTRUMENTS" initial={{left:24,top:430}}>
      <div className="telemetry"><div><span>GATEKEEPER</span><b>ARMED</b></div><div><span>PROPERTY EVIDENCE</span><b>LIVE</b></div><div><span>MAP LAYER</span><b>TRANSLUCENT</b></div><div><span>SCORING</span><b>BOUNDED</b></div></div>
    </DraggablePanel>

    <div className="cockpit-bottom glass"><div><span className="tiny-led"/> MAP VISUAL LAYER</div><div>DRAG PANELS • SCROLL MAP • SELECT TARGETS</div><div>{mode} // {clock.toLocaleDateString()}</div></div>
  </div>;
}
