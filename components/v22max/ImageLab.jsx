"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export default function ImageLab({ images = [], index: startIndex = 0, title = "Property imagery", onClose }) {
  const [index, setIndex] = useState(Math.min(startIndex, Math.max(0, images.length - 1)));
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [fit, setFit] = useState("contain");
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const origin = useRef(null);
  const current = images[index] || null;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(images.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  useEffect(() => {
    setZoom(1); setRotation(0); setBrightness(100); setContrast(100); setSaturation(100); setDrag({x:0,y:0});
  }, [index]);

  const filter = useMemo(() => `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`, [brightness, contrast, saturation]);
  if (!current) return null;
  const src = current.proxyUrl || current.url || current.src;

  return <div onClick={onClose} style={{position:"fixed",inset:0,zIndex:5000,background:"#000e",display:"grid",placeItems:"center",padding:12}}>
    <section onClick={(e)=>e.stopPropagation()} style={{width:"min(1500px,98vw)",height:"min(940px,96vh)",background:"#03080b",border:"1px solid #1d5965",borderRadius:14,overflow:"hidden",display:"grid",gridTemplateRows:"auto 1fr auto auto",boxShadow:"0 30px 100px #000"}}>
      <header style={{display:"flex",justifyContent:"space-between",padding:"12px 14px",borderBottom:"1px solid #173b45"}}>
        <div><div style={{font:"10px ui-monospace,monospace",letterSpacing:".18em",color:"#35eee8"}}>AEROLEADAI IMAGE LAB</div><h2 style={{margin:"3px 0"}}>{title}</h2><small style={{color:"#78949d"}}>Image {index+1} / {images.length}</small></div>
        <button onClick={onClose} style={{background:"transparent",border:0,color:"white",fontSize:26,cursor:"pointer"}}>✕</button>
      </header>
      <div onWheel={(e)=>{e.preventDefault();setZoom(z=>Math.max(.5,Math.min(5,z+(e.deltaY<0?.15:-.15))))}} onMouseDown={(e)=>{setDragging(true);origin.current={x:e.clientX-drag.x,y:e.clientY-drag.y}}} onMouseMove={(e)=>{if(dragging&&origin.current)setDrag({x:e.clientX-origin.current.x,y:e.clientY-origin.current.y})}} onMouseUp={()=>setDragging(false)} onMouseLeave={()=>setDragging(false)} style={{position:"relative",overflow:"hidden",display:"grid",placeItems:"center",background:"radial-gradient(circle,#0c171c,#010304)"}}>
        <img src={src} alt={title} draggable={false} onDoubleClick={()=>setZoom(z=>z===1?2:1)} style={{width:"100%",height:"100%",objectFit:fit,filter,transform:`translate(${drag.x}px,${drag.y}px) scale(${zoom}) rotate(${rotation}deg)`,cursor:zoom>1?"grab":"zoom-in",userSelect:"none"}}/>
        <button disabled={index===0} onClick={()=>setIndex(i=>Math.max(0,i-1))} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:36,width:46,height:72,background:"#001217cc",color:"white",border:"1px solid #245b66"}}>‹</button>
        <button disabled={index>=images.length-1} onClick={()=>setIndex(i=>Math.min(images.length-1,i+1))} style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",fontSize:36,width:46,height:72,background:"#001217cc",color:"white",border:"1px solid #245b66"}}>›</button>
      </div>
      <div style={{display:"flex",gap:7,alignItems:"center",padding:8,overflowX:"auto",borderTop:"1px solid #173b45"}}>
        <button onClick={()=>setZoom(z=>Math.max(.5,z-.25))}>− Zoom</button><b>{Math.round(zoom*100)}%</b><button onClick={()=>setZoom(z=>Math.min(5,z+.25))}>+ Zoom</button><button onClick={()=>setRotation(r=>r-90)}>↶ Rotate</button><button onClick={()=>setRotation(r=>r+90)}>↷ Rotate</button><button onClick={()=>setFit(f=>f==="contain"?"cover":"contain")}>{fit==="contain"?"Fill":"Fit"}</button><button onClick={()=>{setZoom(1);setRotation(0);setBrightness(100);setContrast(100);setSaturation(100);setDrag({x:0,y:0})}}>Reset</button><a href={src} target="_blank" rel="noreferrer" style={{color:"#35eee8",marginLeft:"auto"}}>Open original ↗</a>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,padding:"8px 12px",borderTop:"1px solid #173b45"}}>
        <label>Brightness <input type="range" min="60" max="160" value={brightness} onChange={e=>setBrightness(+e.target.value)}/></label><label>Contrast <input type="range" min="60" max="180" value={contrast} onChange={e=>setContrast(+e.target.value)}/></label><label>Saturation <input type="range" min="0" max="200" value={saturation} onChange={e=>setSaturation(+e.target.value)}/></label>
      </div>
    </section>
  </div>;
}
