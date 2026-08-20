"use client";
import FutureOpsPanel from "./FutureOpsPanel";
import { useEffect,useState } from "react";
const C={panel:"#07131a",line:"#1d4651",cyan:"#2cecea",text:"#ecfbff",mute:"#79959e",green:"#4dffaf",amber:"#ffd166",red:"#ff6f84"};
export default function CommanderPanel({propertyId}){
 const [s,setS]=useState({loading:true,data:null,error:null});
 useEffect(()=>{if(!propertyId)return;fetch(`/api/commander/property/${encodeURIComponent(propertyId)}`).then(r=>r.json()).then(d=>setS({loading:false,data:d,error:d.ok?null:d.error})).catch(e=>setS({loading:false,data:null,error:e.message}));},[propertyId]);
 if(!propertyId)return <Box>Commander requires a saved property ID.</Box>;
 if(s.loading)return <Box>Commander is planning the next research mission…</Box>;
 if(s.error)return <Box>Commander unavailable: {s.error}</Box>;
 const m=s.data.mission;
 return <section style={{background:C.panel,border:`1px solid ${C.line}`,padding:14}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><div style={{fontFamily:"monospace",color:C.cyan,letterSpacing:2,fontSize:11}}>COMMANDER / GATEKEEPER DISCIPLINE</div><h3 style={{margin:"5px 0"}}>Mission: {m.missionStatus}</h3></div><div style={{border:`1px solid ${C.green}`,padding:"8px 12px"}}><small style={{color:C.mute}}>SALES READINESS</small><b style={{display:"block",color:C.green,fontSize:24}}>{m.salesReadiness.score} · {m.salesReadiness.band}</b></div></div>
 <div style={{marginTop:12,padding:12,border:`1px solid ${C.line}`,background:"#050b0f"}}><small style={{color:C.mute}}>NEXT BEST ACTION</small><strong style={{display:"block",fontSize:18,color:C.cyan}}>{m.nextAction.type}</strong><div>{m.nextAction.reason}</div></div>
 {!!m.jury.contradictions.length&&<div style={{marginTop:10,border:`1px solid ${C.red}`,padding:10}}><b style={{color:C.red}}>CONTRADICTIONS</b>{m.jury.contradictions.map(x=><div key={x}>• {x}</div>)}</div>}
 <div style={{marginTop:12}}>{m.queue.map((j,i)=><div key={`${j.type}-${i}`} style={{display:"grid",gridTemplateColumns:"60px 1fr 100px",gap:10,padding:"9px 0",borderBottom:`1px solid ${C.line}`}}><b style={{color:i===0?C.green:C.amber}}>P{j.priority}</b><div><b>{j.type}</b><div style={{color:C.mute,fontSize:12}}>{j.reason}</div></div><small style={{textAlign:"right",color:C.mute}}>{j.costTier}</small></div>)}</div>
 <small style={{display:"block",color:C.mute,marginTop:10}}>Premium-call budget: {m.budget.premiumCallsPlanned}/{m.budget.premiumCallLimit}. Contradictions are never averaged away.</small><div style={{marginTop:12}}><FutureOpsPanel futureOps={m.futureOps}/></div></section>
}
function Box({children}){return <div style={{border:`1px solid ${C.line}`,padding:14,color:C.mute,background:C.panel}}>{children}</div>}
