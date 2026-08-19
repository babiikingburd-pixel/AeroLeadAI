"use client";
import {useEffect,useState} from "react";
import V22MaxConsole from "./V22MaxConsole";

const C={bg:"#03080d",panel:"#071119",line:"#153843",cyan:"#2ef0ea",green:"#4dffaf",amber:"#ffd166",red:"#ff6f84",text:"#edfaff",muted:"#78949d"};
function Stat({label,value,tone=C.text}){return <div style={{minWidth:118,padding:"10px 12px",border:`1px solid ${C.line}`,borderRadius:8,background:C.panel}}><div style={{font:"9px monospace",letterSpacing:1,color:C.muted}}>{label}</div><div style={{fontSize:22,fontWeight:800,color:tone,marginTop:2}}>{value??"—"}</div></div>}

export default function UnifiedCommand({limit=500}){
  const[gk,setGk]=useState(null),[err,setErr]=useState(null);
  useEffect(()=>{let stop=false;fetch("/api/gatekeeper/status",{cache:"no-store"}).then(r=>r.json()).then(j=>{if(!stop)setGk(j)}).catch(e=>{if(!stop)setErr(e.message)});return()=>{stop=true}},[]);
  return <div style={{minHeight:"100vh",background:"radial-gradient(circle at 12% 0,#191233 0,transparent 26%),#02070b",color:C.text}}>
    <section style={{maxWidth:1500,margin:"0 auto",padding:"18px 18px 0"}}>
      <div style={{border:`1px solid ${C.cyan}`,borderRadius:12,padding:14,background:"linear-gradient(135deg,#071119ee,#0b1721ee)",boxShadow:"0 0 50px #2ef0ea12"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div><div style={{font:"10px monospace",letterSpacing:2,color:C.cyan}}>V23 GATEKEEPER CLEAN AUDIT / PRODUCTION CONTROL PLANE</div><h2 style={{margin:"5px 0 4px",fontSize:"clamp(22px,4vw,34px)"}}>V22 MAX intelligence + APEX16 GateKeeper, unified and audited</h2><div style={{color:C.muted,maxWidth:900}}>SOURCE → EVIDENCE → FRESHNESS → CORROBORATION → CONTRADICTION → CONFIDENCE → ACTION. Unknown data stays unknown; questionable properties are held instead of promoted as verified.</div></div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}><Stat label="SYSTEM" value="V23" tone={C.cyan}/><Stat label="ACTIONABLE" value={gk?.verifiedActionable} tone={C.green}/><Stat label="CAUTION" value={gk?.verifiedWithCaution} tone={C.amber}/><Stat label="HELD" value={gk?.held} tone={C.red}/><Stat label="AVG CONF" value={gk?`${Math.round((gk.averageConfidence||0)*100)}%`:"—"}/></div>
        </div>
        <div style={{marginTop:10,font:"10px monospace",color:err?C.red:(gk?.dataMode==="live"?C.green:C.amber)}}>{err?`GATEKEEPER STATUS ERROR: ${err}`:`V23 GATEKEEPER CLEAN AUDIT · ${String(gk?.dataMode||"checking").toUpperCase()} · ${gk?.table||"resolving data source"} · sampled ${gk?.sample??"—"} properties`}</div>
      </div>
    </section>
    <V22MaxConsole limit={limit}/>
  </div>
}
