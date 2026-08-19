"use client";
import { useCallback, useEffect, useState } from "react";
import { HUD } from "../../lib/hudTheme";

const TIERS=[{key:"review",label:"Top 100 Human Review",cap:100},{key:"candidates",label:"Top 500 Candidates",cap:500},{key:"contractor",label:"Top 20 Contractor Package",cap:20}];
const COUNTY_LABEL={hennepin:"Hennepin",ramsey:"Ramsey",dakota:"Dakota",scott:"Scott",carver:"Carver",anoka:"Anoka"};
const REVIEW_COLOR={pending:HUD.amber,approved:HUD.green,partial:HUD.cyan,rejected:HUD.red,needs_images:HUD.muted,contractor_sent:HUD.cyan};

export default function TwinCitiesPriorityPage(){
  const [tier,setTier]=useState("review"),[leads,setLeads]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState(null),[meta,setMeta]=useState(null),[expanded,setExpanded]=useState(null),[imageLead,setImageLead]=useState(null),[crawling,setCrawling]=useState(false),[crawlStatus,setCrawlStatus]=useState(null);

  const load=useCallback(async(t)=>{setLoading(true);setError(null);try{const res=await fetch(`/api/top-leads?tier=${t}&_=${Date.now()}`,{cache:"no-store"});const data=await res.json();if(!data.ok)throw new Error(data.error||"Unable to load leads");setLeads(data.leads||[]);setMeta({scanned:data.scanned,entered:data.entered,cap:data.cap,top100Count:data.top100Count,top500Count:data.top500Count});}catch(e){setError(e.message)}finally{setLoading(false)}},[]);
  useEffect(()=>{load(tier)},[tier,load]);

  function chooseTier(next){if(next===tier)load(next);else setTier(next);setExpanded(null)}
  async function setReviewStatus(id,status){setLeads(cur=>cur.map(l=>l.id===id?{...l,reviewStatus:status}:l));try{await fetch("/api/lead-review",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,status})})}catch{}}
  async function runEvidenceCycle(){setCrawling(true);setCrawlStatus({ok:true,message:"Searching permits, storm/weather and imagery for the strongest unresolved properties…"});try{const res=await fetch("/api/twincities/evidence-cycle",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({limit:8})});const data=await res.json();setCrawlStatus({ok:!!data.ok,message:data.ok?`Evidence swarm processed ${data.processed}; ${data.persisted??data.processed} persisted. Reloading confidence…`:(data.error||"Evidence cycle failed")});if(data.ok)await load(tier)}catch(e){setCrawlStatus({ok:false,message:e.message})}finally{setCrawling(false)}}

  return <main style={{minHeight:"100vh",background:HUD.bg,color:HUD.ice,fontFamily:HUD.fontMono,padding:"20px 24px"}}>
    <div style={{maxWidth:1500,margin:"0 auto"}}>
      <div style={{fontFamily:HUD.fontDisplay,fontSize:24,fontWeight:800,color:HUD.cyan,letterSpacing:".04em"}}>TWIN CITIES PRIORITY ENGINE</div>
      <div style={{fontSize:12,color:HUD.muted,margin:"5px 0 16px"}}>Top 100 is the human-review front line. Top 500 is the live ranked pool. Every property card now opens its imagery and a full scorecard.</div>

      <div style={{display:"flex",gap:9,flexWrap:"wrap",marginBottom:12}}>
        {TIERS.map(t=><button key={t.key} onClick={()=>chooseTier(t.key)} style={button(tier===t.key?HUD.cyan:HUD.lineDim,tier===t.key?HUD.cyan:HUD.muted)}>{t.label}</button>)}
        <button onClick={()=>load(tier)} style={button(HUD.green,HUD.green)}>↻ REFRESH</button>
        <button onClick={()=>window.open("/twincities/contractor-prospects","_blank","noopener,noreferrer")} style={button(HUD.green,HUD.green)}>🏠 CONTRACTOR PROSPECTS</button>
        <button onClick={()=>window.open("/twincities/apex10","_blank","noopener,noreferrer")} style={button(HUD.amber,HUD.amber)}>🎯 APEX REPORT</button>
        <button disabled={crawling} onClick={runEvidenceCycle} style={{...button(HUD.cyan,HUD.cyan),opacity:crawling?.55:1}}>{crawling?"🧠 SEARCHING…":"🧠 RUN EVIDENCE SWARM"}</button>
      </div>

      {meta&&<div style={{fontSize:11,color:HUD.muted,marginBottom:10}}>Scanned {meta.scanned??0} · Ranked {meta.entered??0} · Top 100 {meta.top100Count??0}/100 · Top 500 {meta.top500Count??0}/500 · Viewing {meta.cap}</div>}
      {crawlStatus&&<div style={{fontSize:11,color:crawlStatus.ok?HUD.green:HUD.red,marginBottom:12,padding:"8px 10px",border:`1px solid ${crawlStatus.ok?HUD.green:HUD.red}`,borderRadius:5}}>{crawlStatus.message}</div>}
      {loading&&<div style={{color:HUD.cyan,fontSize:12,marginBottom:10}}>RANKING + RENDERING PROPERTIES…</div>}
      {error&&<div style={{color:HUD.red,fontSize:12,marginBottom:10}}>Error: {error}</div>}

      <div style={{display:"flex",flexDirection:"column",gap:9}}>{leads.map((lead,idx)=><LeadRow key={lead.id} lead={lead} idx={idx} tier={tier} expanded={expanded===lead.id} toggle={()=>setExpanded(expanded===lead.id?null:lead.id)} openImage={()=>setImageLead(lead)} review={setReviewStatus}/>)}</div>
    </div>
    {imageLead&&<ImageViewer lead={imageLead} close={()=>setImageLead(null)}/>} 
  </main>
}

function LeadRow({lead,idx,tier,expanded,toggle,openImage,review}){
  const status=lead.sourceStatus||{};const sourceCount=[status.permit,status.storm,status.assessor,status.imagery].filter(Boolean).length;
  return <article style={{border:`1px solid ${expanded?HUD.cyan:HUD.lineDim}`,borderRadius:7,background:"rgba(5,14,20,.72)",overflow:"hidden"}}>
    <div style={{display:"grid",gridTemplateColumns:"46px 78px minmax(220px,1fr) minmax(210px,.75fr) 92px 110px",gap:12,alignItems:"center",padding:"11px 13px"}}>
      <div style={{color:HUD.cyan,fontSize:13,fontWeight:900}}>#{lead.rank||idx+1}</div>
      <button onClick={openImage} title="Open property imagery" style={{padding:0,border:`1px solid ${HUD.lineDim}`,borderRadius:5,overflow:"hidden",height:68,width:68,background:"#020608",cursor:"zoom-in"}}>{lead.imageUrl?<img src={lead.imageUrl} alt={lead.address} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>:<span style={{fontSize:9,color:HUD.muted}}>NO IMAGE</span>}</button>
      <div><div style={{fontSize:13,fontWeight:800,lineHeight:1.25}}>{lead.address}</div><div style={{fontSize:11,color:HUD.muted,marginTop:3}}>{lead.city} · {COUNTY_LABEL[lead.county]||lead.county} County</div><div style={{fontSize:9,color:lead.imageIsFallback?HUD.amber:HUD.green,marginTop:4}}>{lead.imageIsFallback?"ESRI FALLBACK — CLICKABLE":"CACHED/PROVIDER IMAGE — CLICKABLE"}</div></div>
      <div><div style={{fontSize:11,color:HUD.muted}}>Evidence <b style={{color:HUD.ice}}>{lead.evidenceScore}</b> · Confidence <b style={{color:lead.confidenceScore>=70?HUD.green:lead.confidenceScore>=35?HUD.amber:HUD.red}}>{lead.confidenceScore}%</b></div><div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:7}}><SourcePill label="PERMIT" ok={status.permit}/><SourcePill label="STORM" ok={status.storm}/><SourcePill label="VALUE" ok={status.assessor}/><SourcePill label="IMAGE" ok={status.imagery}/></div><div style={{fontSize:9,color:HUD.muted,marginTop:5}}>{sourceCount}/4 machine evidence lanes complete</div></div>
      <div style={{fontSize:19,fontWeight:900,color:HUD.cyan,textAlign:"right"}}>{lead.priorityScore}</div>
      <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"stretch"}}><span style={{fontSize:9,fontWeight:800,padding:"4px 7px",borderRadius:10,textAlign:"center",color:REVIEW_COLOR[lead.reviewStatus]||HUD.muted,border:`1px solid ${REVIEW_COLOR[lead.reviewStatus]||HUD.muted}`}}>{String(lead.reviewStatus||"pending").toUpperCase()}</span><button onClick={toggle} style={button(HUD.cyan,HUD.cyan)}>{expanded?"HIDE":"SCORECARD"}</button></div>
    </div>
    {expanded&&<Scorecard lead={lead} tier={tier} review={review} openImage={openImage}/>} 
  </article>
}

function Scorecard({lead,tier,review,openImage}){const status=lead.sourceStatus||{};return <div style={{borderTop:`1px solid ${HUD.lineDim}`,padding:14,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:12,background:"rgba(0,0,0,.22)"}}>
  <Panel title="WHY THIS RANK"><div style={{fontSize:12}}>Priority score <b style={{color:HUD.cyan}}>{lead.priorityScore}</b></div><div style={{fontSize:11,color:HUD.muted,marginTop:6}}>Evidence {lead.evidenceScore} · Confidence {lead.confidenceScore}% · Tier {lead.tier||"—"}</div><div style={{marginTop:8}}>{Object.entries(lead.breakdown||{}).map(([k,v])=><div key={k} style={{fontSize:10,color:HUD.muted,margin:"3px 0"}}>{k.replace(/_/g," ")}: <b style={{color:HUD.ice}}>{String(v)}</b></div>)}</div></Panel>
  <Panel title="CONFIDENCE SOURCES"><SourceLine label="Permit search" ok={status.permit}/><SourceLine label="Storm/weather search" ok={status.storm}/><SourceLine label="Assessor/value" ok={status.assessor}/><SourceLine label="Imagery evidence" ok={status.imagery}/><div style={{fontSize:9,color:HUD.muted,marginTop:7}}>Confidence rises only when a real evidence lane is completed; it is not padded by default false values.</div></Panel>
  <Panel title="PROPERTY"><div style={{fontSize:11,color:HUD.muted}}>Assessed value</div><div style={{fontSize:17,fontWeight:800,marginTop:3}}>{lead.assessedValue?`$${Number(lead.assessedValue).toLocaleString()}`:"Not enriched"}</div><button onClick={openImage} style={{...button(HUD.cyan,HUD.cyan),marginTop:10}}>OPEN IMAGE</button><a href={lead.googleMapsUrl} target="_blank" rel="noreferrer" style={{...button(HUD.green,HUD.green),display:"block",textAlign:"center",textDecoration:"none",marginTop:7}}>OPEN GOOGLE MAPS ↗</a></Panel>
  <Panel title="HUMAN REVIEW"><div style={{fontSize:10,color:HUD.muted,marginBottom:8}}>Top 100 is a review queue, so these controls stay directly on the scorecard.</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button onClick={()=>review(lead.id,"approved")} style={button(HUD.green,HUD.green)}>APPROVE</button><button onClick={()=>review(lead.id,"partial")} style={button(HUD.cyan,HUD.cyan)}>PARTIAL</button><button onClick={()=>review(lead.id,"needs_images")} style={button(HUD.amber,HUD.amber)}>NEEDS IMAGE</button><button onClick={()=>review(lead.id,"rejected")} style={button(HUD.red,HUD.red)}>REJECT</button></div>{tier==="review"&&<div style={{fontSize:9,color:HUD.amber,marginTop:8}}>Reviewing this property can add the human-confidence component after machine evidence is present.</div>}</Panel>
</div>}

function ImageViewer({lead,close}){return <div onClick={close} style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,.88)",display:"grid",placeItems:"center",padding:20}}><div onClick={e=>e.stopPropagation()} style={{width:"min(1100px,96vw)",maxHeight:"92vh",overflow:"auto",background:"#041016",border:`1px solid ${HUD.cyan}`,borderRadius:9,padding:12}}><div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:10}}><div><b>{lead.address}</b><div style={{fontSize:10,color:HUD.muted}}>Clicking the thumbnail now opens this full property view.</div></div><button onClick={close} style={button(HUD.red,HUD.red)}>CLOSE ✕</button></div>{lead.imageUrl?<img src={lead.imageUrl} alt={lead.address} style={{width:"100%",maxHeight:"68vh",objectFit:"contain",background:"#000",display:"block"}}/>:<div style={{height:400,display:"grid",placeItems:"center",color:HUD.muted}}>No image available yet.</div>}<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}><a href={lead.imageUrl||"#"} target="_blank" rel="noreferrer" style={{...button(HUD.cyan,HUD.cyan),textDecoration:"none"}}>OPEN IMAGE SOURCE ↗</a><a href={lead.googleMapsUrl} target="_blank" rel="noreferrer" style={{...button(HUD.green,HUD.green),textDecoration:"none"}}>OPEN ADDRESS IN GOOGLE MAPS ↗</a></div></div></div>}
function Panel({title,children}){return <div style={{border:`1px solid ${HUD.lineDim}`,borderRadius:6,padding:11}}><div style={{fontSize:10,color:HUD.cyan,fontWeight:900,letterSpacing:".08em",marginBottom:8}}>{title}</div>{children}</div>}
function SourcePill({label,ok}){return <span style={{fontSize:8,padding:"3px 5px",borderRadius:8,border:`1px solid ${ok?HUD.green:HUD.lineDim}`,color:ok?HUD.green:HUD.muted}}>{ok?"✓":"○"} {label}</span>}
function SourceLine({label,ok}){return <div style={{display:"flex",justifyContent:"space-between",fontSize:10,padding:"4px 0",color:HUD.muted}}><span>{label}</span><b style={{color:ok?HUD.green:HUD.amber}}>{ok?"COMPLETE":"SEARCH NEEDED"}</b></div>}
function button(border,color){return {padding:"7px 10px",borderRadius:5,cursor:"pointer",fontSize:10,fontWeight:800,border:`1px solid ${border}`,background:"rgba(0,0,0,.14)",color}}
