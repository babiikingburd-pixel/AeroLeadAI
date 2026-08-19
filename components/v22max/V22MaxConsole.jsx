"use client";
import {useCallback,useEffect,useMemo,useState} from "react";

const C={bg:"#02070b",panel:"#071119",panel2:"#0a1720",line:"#153843",cyan:"#2ef0ea",green:"#4dffaf",amber:"#ffd166",red:"#ff6f84",text:"#edfaff",muted:"#78949d"};
const TABS=[
  ["NOW","NOW"],["0-3 MONTHS","0–3 MO"],["3-6 MONTHS","3–6 MO"],["6-12 MONTHS","6–12 MO"],["WATCH","WATCH"],["REVIEW100","TOP 100 REVIEW"],["TOP500","TOP 500"]
];
const fmt=v=>v===null||v===undefined||v===""?"UNKNOWN":String(v);
const num=v=>Number.isFinite(Number(v))?Number(v):0;

function Metric({label,value,tone=C.text}){return <div style={{padding:"9px 10px",border:`1px solid ${C.line}`,borderRadius:7,background:C.panel2,minWidth:100}}><div style={{font:"9px monospace",letterSpacing:1,color:C.muted}}>{label}</div><b style={{display:"block",fontSize:18,color:tone,marginTop:2}}>{value}</b></div>}
function State({label,value}){const known=value&&String(value).toLowerCase()!=="unknown";return <div style={{border:`1px solid ${known?C.green:C.amber}`,borderRadius:7,padding:9}}><div style={{font:"9px monospace",color:C.muted}}>{label}</div><div style={{color:known?C.green:C.amber,fontWeight:800,fontSize:12,marginTop:3}}>{fmt(value)}</div></div>}
function mapsUrl(p){const q=[p.address,p.city,p.state,p.zip].filter(Boolean).join(", ");return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;}

function Card({p,onOpen}){
  const score=Math.round(num(p.display_score));
  return <button onClick={()=>onOpen(p)} style={{display:"block",width:"100%",textAlign:"left",background:C.panel,border:`1px solid ${p.review_required?C.amber:C.line}`,borderRadius:12,padding:0,color:C.text,cursor:"pointer",overflow:"hidden",boxShadow:"0 12px 30px #0007"}}>
    <div style={{height:92,background:"linear-gradient(135deg,#0d2630,#071119)",padding:13,position:"relative"}}>
      <div style={{font:"10px monospace",color:C.cyan,letterSpacing:1.3}}>{p.display_window||"PROPERTY"}{p.top500_rank?` · TOP 500 #${p.top500_rank}`:""}</div>
      <div style={{fontSize:18,fontWeight:850,marginTop:8,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",paddingRight:62}}>{p.address||`Property ${p.id}`}</div>
      <div style={{color:C.muted,fontSize:11,marginTop:4}}>{[p.city,p.county,p.state,p.zip].filter(Boolean).join(" · ")||"Location details available in record"}</div>
      <div style={{position:"absolute",right:12,top:12,width:48,height:48,borderRadius:24,border:`2px solid ${score>=64?C.green:score>=49?C.amber:C.cyan}`,display:"grid",placeItems:"center",fontWeight:900,fontSize:17}}>{score}</div>
    </div>
    <div style={{padding:13}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6}}><Metric label="EVIDENCE" value={fmt(p.evidence_score)}/><Metric label="CONFIDENCE" value={p.confidence_score!=null?`${p.confidence_score}%`:"UNKNOWN"}/><Metric label="ROOF" value={fmt(p.roof_visual_score??p.roof_score)}/></div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10,font:"9px monospace"}}>
        <span style={{padding:"5px 7px",border:`1px solid ${C.line}`}}>YEAR {fmt(p.year_built)}</span><span style={{padding:"5px 7px",border:`1px solid ${C.line}`}}>VALUE {p.assessed_value?`$${Number(p.assessed_value).toLocaleString()}`:"UNKNOWN"}</span><span style={{padding:"5px 7px",border:`1px solid ${p.review_required?C.amber:C.line}`,color:p.review_required?C.amber:C.text}}>{p.review_required?"HUMAN REVIEW":"OPEN RECORD"}</span>
      </div>
      <div style={{marginTop:10,color:C.cyan,font:"10px monospace"}}>CLICK FOR FULL PROPERTY INTELLIGENCE →</div>
    </div>
  </button>
}

function Drawer({lead,onClose}){
  const[d,setD]=useState(null),[err,setErr]=useState(null);
  useEffect(()=>{if(!lead)return;setD(null);setErr(null);fetch(`/api/v23/property?id=${encodeURIComponent(lead.id)}`,{cache:"no-store"}).then(r=>r.json()).then(j=>j.success?setD(j):setErr(j.error||"Property detail unavailable")).catch(e=>setErr(e.message))},[lead?.id]);
  if(!lead)return null;
  const p=d?.property||lead, imgs=d?.images||[], hero=imgs.find(i=>i.enhanced_image_url||i.image_url||i.original_image_url), heroUrl=hero&&(hero.enhanced_image_url||hero.image_url||hero.original_image_url);
  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:9999,background:"#000d",padding:10,overflowY:"auto"}}><div onClick={e=>e.stopPropagation()} style={{maxWidth:1180,margin:"18px auto",background:C.bg,border:`1px solid ${C.cyan}`,borderRadius:14,overflow:"hidden",color:C.text}}>
    <header style={{padding:16,display:"flex",justifyContent:"space-between",gap:10}}><div><div style={{font:"10px monospace",letterSpacing:2,color:C.cyan}}>V23 GATEKEEPER / COMPLETE PROPERTY RECORD</div><h2 style={{margin:"5px 0"}}>{p.address||p.id}</h2><div style={{color:C.muted}}>{[p.city,p.county,p.state,p.zip].filter(Boolean).join(" · ")}</div></div><button onClick={onClose} style={{background:"transparent",border:0,color:C.text,fontSize:30,cursor:"pointer"}}>×</button></header>
    {heroUrl?<img src={heroUrl} alt={p.address||"property"} style={{width:"100%",height:360,objectFit:"cover",background:"#000"}}/>:<div style={{height:240,display:"grid",placeItems:"center",background:"radial-gradient(circle,#10313a,#02070a 65%)",textAlign:"center",padding:20}}><div><div style={{fontSize:26,color:C.cyan}}>NO VERIFIED IMAGE STORED YET</div><div style={{color:C.muted,marginTop:8}}>The property remains clickable and fully reviewable. Imagery status is shown below.</div><a href={mapsUrl(p)} target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:14,color:C.cyan}}>OPEN PROPERTY IN GOOGLE MAPS ↗</a></div></div>}
    {err?<div style={{padding:14,color:C.red}}>{err}</div>:!d?<div style={{padding:20,color:C.muted}}>Loading evidence, findings, images and GateKeeper decision…</div>:<>
      <section style={{padding:16,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(135px,1fr))",gap:8}}><Metric label="PRIORITY" value={fmt(p.priority_score)}/><Metric label="OPPORTUNITY" value={fmt(p.opportunity_score)}/><Metric label="EVIDENCE" value={fmt(p.evidence_score)}/><Metric label="CONFIDENCE" value={p.confidence_score!=null?`${p.confidence_score}%`:"UNKNOWN"}/><Metric label="VALIDATION" value={fmt(p.validation_score)}/><Metric label="ROOF VISUAL" value={fmt(p.roof_visual_score)}/><Metric label="HAZARD" value={fmt(p.hazard_score)}/><Metric label="TOP500 SLOT" value={fmt(p.top500_slot)}/></section>
      <section style={{padding:"0 16px 16px"}}><h3>Evidence state</h3><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}><State label="PERMIT" value={d.unknowns?.permit}/><State label="IMAGERY" value={d.unknowns?.image}/><State label="WEATHER / STORM" value={d.unknowns?.weather}/><State label="PROPERTY VALUE" value={d.unknowns?.value}/><State label="VALIDATION" value={d.unknowns?.validation}/></div></section>
      <section style={{padding:"0 16px 16px",display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:10}}><div style={{border:`1px solid ${C.line}`,padding:12}}><b style={{color:C.cyan}}>GATEKEEPER</b><div style={{fontSize:20,fontWeight:900,marginTop:6}}>{d.gatekeeper?.status}</div><div style={{color:C.muted,marginTop:5}}>Confidence {Math.round(num(d.gatekeeper?.confidence)*100)}% · {d.gatekeeper?.evidenceCount||0} evidence items</div></div><div style={{border:`1px solid ${C.line}`,padding:12}}><b style={{color:C.cyan}}>HISTORY BEHIND THIS PROPERTY</b><div style={{marginTop:6}}>{imgs.length} stored images · {d.findings?.length||0} crawler findings · {d.evidenceEvents?.length||0} Apex evidence events · {d.leaderboard?.length||0} leaderboard records</div></div></section>
      <section style={{padding:"0 16px 18px"}}><details open><summary style={{cursor:"pointer",color:C.cyan,fontWeight:800}}>ALL AVAILABLE PROPERTY INFORMATION</summary><pre style={{whiteSpace:"pre-wrap",wordBreak:"break-word",fontSize:11,color:C.muted,background:C.panel,padding:12,border:`1px solid ${C.line}`,maxHeight:420,overflow:"auto"}}>{JSON.stringify(p,null,2)}</pre></details></section>
    </>}
  </div></div>
}

export default function V22MaxConsole(){
  const[tab,setTab]=useState("NOW"),[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(null),[selected,setSelected]=useState(null);
  const load=useCallback(async(t=tab)=>{setLoading(true);setError(null);try{const limit=t==="TOP500"?500:100;const r=await fetch(`/api/v23/properties?tab=${encodeURIComponent(t)}&limit=${limit}`,{cache:"no-store"});const j=await r.json();if(!j.success)throw new Error(j.error||"Property feed failed");setData(j)}catch(e){setError(e.message)}finally{setLoading(false)}},[tab]);
  useEffect(()=>{load(tab)},[tab,load]);
  const rows=data?.rows||[];
  return <main style={{minHeight:"100vh",background:C.bg,color:C.text,padding:18,fontFamily:"Inter,system-ui,sans-serif"}}><div style={{maxWidth:1500,margin:"auto"}}>
    <header style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap",alignItems:"flex-start",marginBottom:14}}><div><div style={{font:"11px monospace",color:C.cyan,letterSpacing:2}}>V23 GATEKEEPER CLEAN AUDIT / LIVE PROPERTY COMMAND</div><h1 style={{margin:"5px 0",fontSize:"clamp(28px,5vw,46px)"}}>Every tab is live. Every property opens.</h1><div style={{color:C.muted}}>No blank stubs: unknown data is labeled UNKNOWN and remains available for human review.</div></div>{data?.counts?<div style={{display:"flex",gap:6,flexWrap:"wrap"}}><Metric label="LEADS" value={Number(data.counts.leads).toLocaleString()}/><Metric label="IMAGES" value={data.counts.images}/><Metric label="TOP500 SLOTS" value={data.counts.top500Slots}/><Metric label="FINDINGS" value={data.counts.crawlerFindings}/><Metric label="LEADERBOARD" value={Number(data.counts.leaderboardRows).toLocaleString()}/></div>:null}</header>
    <nav style={{display:"flex",gap:7,flexWrap:"wrap",position:"sticky",top:0,zIndex:20,background:"#02070bf2",padding:"10px 0",marginBottom:14}}>{TABS.map(([key,label])=><button key={key} onClick={()=>setTab(key)} style={{padding:"9px 11px",border:`1px solid ${tab===key?C.cyan:C.line}`,background:tab===key?C.cyan:C.panel,color:tab===key?"#001014":C.text,borderRadius:7,fontWeight:800,cursor:"pointer"}}>{label}</button>)}<button onClick={()=>load(tab)} style={{padding:"9px 11px",marginLeft:"auto",border:`1px solid ${C.line}`,background:C.panel,color:C.cyan,borderRadius:7,cursor:"pointer"}}>REFRESH LIVE</button></nav>
    <div style={{marginBottom:12,color:C.muted,font:"11px monospace"}}>{loading?"QUERYING LIVE SUPABASE…":`${rows.length} CLICKABLE PROPERTIES LOADED FOR ${TABS.find(x=>x[0]===tab)?.[1]||tab}`}</div>
    {error?<div style={{padding:14,border:`1px solid ${C.red}`,color:C.red}}>{error}</div>:loading?<div style={{padding:50,textAlign:"center",color:C.muted}}>Loading live property records…</div>:<section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(310px,1fr))",gap:14}}>{rows.map(p=><Card key={p.id} p={p} onOpen={setSelected}/>)}</section>}
    <Drawer lead={selected} onClose={()=>setSelected(null)}/>
  </div></main>;
}
