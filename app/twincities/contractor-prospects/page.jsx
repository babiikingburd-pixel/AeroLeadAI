"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import ImageLab from "../../../components/v22max/ImageLab";

const C={bg:"#03070a",panel:"#071016",line:"#173b45",cyan:"#35eee8",ice:"#ecfbff",muted:"#78949d",amber:"#ffb14a",red:"#ff765f",green:"#4dffb3"};

export default function ContractorProspectsPage(){
  const [prospects,setProspects]=useState([]),[selected,setSelected]=useState(null),[leads,setLeads]=useState([]),[loading,setLoading]=useState(true),[prioritizing,setPrioritizing]=useState(null),[media,setMedia]=useState({}),[lab,setLab]=useState(null);
  const queue=useRef([]),active=useRef(0),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false},[]);

  function hydrateLeadMedia(nextLeads=[]){
    const seeded={};
    for(const l of nextLeads){
      if(l?.id && Array.isArray(l.images) && l.images.length){
        seeded[l.id]={loading:false,images:l.images,status:"READY · CLICK ANY IMAGE",eager:true};
      }
    }
    setMedia(seeded);
  }

  async function load(name){
    setLoading(true);
    try{
      const r=await fetch(`/api/contractor-prospects${name?`?name=${encodeURIComponent(name)}`:""}`,{cache:"no-store"});
      const d=await r.json();
      if(d.ok){
        setProspects(d.prospects||[]);
        if(name){
          const next=d.leads||[];
          setSelected(d.contractor);setLeads(next);hydrateLeadMedia(next);
        }
      }
    }finally{setLoading(false)}
  }
  async function prioritize(name){setPrioritizing(name);try{const r=await fetch("/api/contractor-prospects/prioritize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({businessName:name})});const d=await r.json();if(d.ok){setSelected(d.contractor);const next=d.leads||[];setLeads(next);hydrateLeadMedia(next);}}finally{setPrioritizing(null)}}
  useEffect(()=>{load()},[]);

  function pump(){
    while(active.current<4&&queue.current.length){
      const l=queue.current.shift();if(!l||media[l.id])continue;active.current++;
      setMedia(s=>({...s,[l.id]:{loading:true,images:[],status:"ACQUIRING · CROPPING · ANALYZING"}}));
      const address=[l.address||l.property_address,l.city,l.state||"MN",l.zip].filter(Boolean).join(", ");
      fetch("/api/eagleview",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({address,lat:l.lat,lon:l.lon,wait:true,maxWaitMs:18000})})
        .then(r=>r.json()).then(x=>mounted.current&&setMedia(s=>({...s,[l.id]:{loading:false,images:x.images||[],status:(x.images||[]).length?"READY · CLICK ANY IMAGE":"IMAGE UNAVAILABLE",error:x.ok?null:x.error}})))
        .catch(e=>mounted.current&&setMedia(s=>({...s,[l.id]:{loading:false,images:[],status:"RETRY IMAGE",error:e.message}})))
        .finally(()=>{active.current--;if(mounted.current)setTimeout(pump,30)});
    }
  }
  useEffect(()=>{if(!leads.length)return;queue.current=leads.filter(l=>!media[l.id] && !(Array.isArray(l.images)&&l.images.length));pump();},[leads,media]);

  const pitch=selected?`Hi, I’m local and I built a Twin Cities property/storm intelligence system for roofing companies. I’m testing it with a small group of local contractors and built a territory-specific report for ${selected.business_name}. It identifies properties that are worth an inspection based on documented storm/property signals — not claims of confirmed damage. I’d like to show you 10 opportunities in your service area and let you judge whether they’re useful. If they produce real inspections, we can discuss a small paid pilot and territory exclusivity.`:"";
  const ready=useMemo(()=>Object.values(media).filter(x=>x.images?.length).length,[media]);

  return <main style={{minHeight:"100vh",background:"radial-gradient(circle at 86% 0,#0a3440 0,transparent 34%),#03070a",color:C.ice,fontFamily:"Inter,system-ui,sans-serif",padding:24}}>
    <div style={{maxWidth:1500,margin:"auto"}}>
      <a href="/twincities" style={{color:C.cyan,textDecoration:"none",fontSize:12}}>← TWIN CITIES ENGINE</a>
      <header style={{display:"flex",justifyContent:"space-between",gap:18,alignItems:"end",flexWrap:"wrap",marginTop:18}}>
        <div><div style={{font:"11px ui-monospace,monospace",letterSpacing:".18em",color:C.cyan}}>AEROLEADAI / CONTRACTOR INTELLIGENCE</div><h1 style={{fontSize:"clamp(34px,5vw,62px)",lineHeight:.95,margin:"8px 0"}}>Visual Prospect Command</h1><p style={{color:C.muted,maxWidth:780}}>Visual-first by default. Opening a contractor now triggers EagleView on the ranked territory set before the cards are presented.</p></div>
        <a href="/twincities/contractor-prospects/add" style={{padding:"12px 16px",border:`1px solid ${C.amber}`,color:C.amber,borderRadius:8,textDecoration:"none",fontWeight:800}}>+ ADD CONTRACTOR</a>
      </header>

      {loading&&<div style={{color:C.cyan,fontFamily:"monospace",marginTop:25}}>SEARCHING TERRITORY + ACQUIRING PROPERTY IMAGERY…</div>}

      {!selected&&!loading&&<section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))",gap:14,marginTop:24}}>{prospects.map((p,i)=><article key={p.business_name} style={{border:`1px solid ${C.line}`,background:"#061016",padding:17,borderRadius:13,boxShadow:"0 15px 45px #0007"}}><div style={{font:"10px ui-monospace,monospace",color:C.cyan}}>PROSPECT #{i+1}</div><h2 style={{margin:"6px 0 3px",fontSize:21}}>{p.business_name}</h2><div style={{color:C.green,fontWeight:800}}>Pitch fit {p.prospect_score}/100</div><p style={{color:C.muted,fontSize:12,minHeight:34}}>Target: {(p.service_area_cities||[]).slice(0,5).join(" · ")}</p><div style={{display:"flex",gap:8}}><button onClick={()=>load(p.business_name)} style={btn(C.cyan)}>OPEN VISUAL LEADS</button><button onClick={()=>prioritize(p.business_name)} disabled={prioritizing===p.business_name} style={btn(C.red)}>{prioritizing===p.business_name?"RECALIBRATING…":"PRIORITIZE"}</button></div></article>)}</section>}

      {selected&&!loading&&<section style={{marginTop:20}}>
        <button onClick={async()=>{setSelected(null);setLeads([]);setMedia({});await load();}} style={btn(C.muted)}>← ALL PROSPECTS</button>
        <div style={{display:"grid",gridTemplateColumns:"1.1fr .9fr",gap:14,marginTop:14}}>
          <div style={{border:`1px solid ${C.line}`,background:"#061016",padding:17,borderRadius:12}}><div style={{font:"10px ui-monospace,monospace",color:C.amber}}>SALES PITCH / {selected.business_name}</div><p style={{lineHeight:1.55,color:"#cfe3e8"}}>{pitch}</p><button onClick={()=>navigator.clipboard?.writeText(pitch)} style={btn(C.green)}>COPY PITCH</button></div>
          <div style={{border:`1px solid ${C.line}`,background:"#061016",padding:17,borderRadius:12}}><div style={{font:"10px ui-monospace,monospace",color:C.cyan}}>EAGER VISUAL PIPELINE</div><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:10}}><Stat l="LEADS" v={leads.length}/><Stat l="IMAGES READY" v={ready}/><Stat l="FALLBACK SCANS" v={Object.values(media).filter(x=>x.loading).length}/></div></div>
        </div>

        {leads.length===0?<div style={{color:C.muted,marginTop:20}}>No qualifying leads were returned. AeroLeadAI will not invent addresses.</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(315px,1fr))",gap:16,marginTop:18}}>{leads.map((l,i)=><LeadCard key={l.id||i} lead={l} rank={i+1} media={media[l.id]||{images:l.images||[],loading:false,status:l.image_status||"WAIT"}} open={(images,index)=>setLab({images,index,title:l.address||l.property_address||"Property imagery"})}/>)}</div>}
      </section>}
    </div>
    {lab&&<ImageLab {...lab} onClose={()=>setLab(null)}/>} 
  </main>
}

function LeadCard({lead,rank,media,open}){const images=media?.images||[],hero=images[0];return <article style={{background:"#061016",border:`1px solid ${C.line}`,borderRadius:13,overflow:"hidden",boxShadow:"0 15px 50px #0008"}}><button onClick={()=>hero&&open(images,0)} style={{height:235,width:"100%",padding:0,border:0,background:"#020608",position:"relative",cursor:hero?"zoom-in":"default",overflow:"hidden",color:C.ice}}>{hero?<img src={hero.proxyUrl||hero.url} alt={lead.address||"Property"} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<div style={{height:"100%",display:"grid",placeItems:"center",padding:20,color:C.muted,font:"11px ui-monospace,monospace"}}>{media?.status||"IMAGE UNAVAILABLE"}</div>}<div style={{position:"absolute",right:10,top:10,padding:"8px 10px",background:"#001217e8",border:`1px solid ${C.cyan}`,color:C.cyan,fontWeight:900,fontSize:22}}>{Math.round(lead._score||lead.score||0)}</div><div style={{position:"absolute",left:10,bottom:10,padding:"6px 9px",background:"#001217e8",border:`1px solid ${C.line}`,font:"10px ui-monospace,monospace"}}>#{rank} · {hero?"CLICK TO ENHANCE":"VISUAL ANALYSIS"}</div></button>{images.length>1&&<div style={{display:"flex",gap:5,padding:6,overflowX:"auto"}}>{images.slice(1,5).map((im,j)=><button key={im.token||j} onClick={()=>open(images,j+1)} style={{padding:0,border:`1px solid ${C.line}`,background:"#000",cursor:"zoom-in"}}><img src={im.proxyUrl||im.url} alt="Additional property view" style={{width:74,height:52,objectFit:"cover",display:"block"}}/></button>)}</div>}<div style={{padding:15}}><div style={{font:"10px ui-monospace,monospace",color:C.cyan}}>TERRITORY OPPORTUNITY</div><h3 style={{margin:"6px 0",fontSize:18}}>{lead.address||lead.property_address||"Address unavailable"}</h3><div style={{color:C.muted,fontSize:12}}>{lead.city||"Twin Cities"}</div><div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginTop:12}}><Mini l="SCORE" v={Math.round(lead._score||0)}/><Mini l="IMAGES" v={images.length}/><Mini l="STATUS" v={images.length?"READY":media?.loading?"SCAN":"WAIT"}/></div></div></article>}
function Stat({l,v}){return <div style={{border:`1px solid ${C.line}`,padding:10}}><b style={{display:"block",fontSize:24,color:C.cyan}}>{v}</b><span style={{font:"9px ui-monospace,monospace",color:C.muted}}>{l}</span></div>}
function Mini({l,v}){return <div style={{border:`1px solid ${C.line}`,padding:8,background:"#040b0f"}}><span style={{display:"block",font:"9px ui-monospace,monospace",color:C.muted}}>{l}</span><b style={{display:"block",marginTop:4,fontSize:14,overflow:"hidden",textOverflow:"ellipsis"}}>{v}</b></div>}
function btn(color){return {padding:"9px 12px",background:"transparent",border:`1px solid ${color}`,color,borderRadius:7,cursor:"pointer",fontSize:11,fontWeight:800}}
