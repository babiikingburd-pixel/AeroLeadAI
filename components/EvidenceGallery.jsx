import { useEffect, useState } from "react";

const LABELS = {
  property_overview: "PROPERTY",
  roof_detail: "ROOF",
  driveway_detail: "DRIVEWAY",
  exterior_detail: "EXTERIOR",
  grounds_detail: "GROUNDS",
};

export default function EvidenceGallery({ propertyId }) {
  const [data,setData] = useState(null);
  useEffect(() => {
    if (!propertyId) return;
    fetch(`/api/twincities/evidence-manifest?id=${encodeURIComponent(propertyId)}`)
      .then(r=>r.json()).then(setData).catch(()=>{});
  },[propertyId]);

  if (!data) return <div style={{fontSize:12,opacity:.7}}>Loading evidence…</div>;

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
      {Object.entries(LABELS).map(([kind,label]) => {
        const image = data.images?.[kind];
        const src = image?.enhanced_image_url || image?.image_url || image?.original_image_url;
        return (
          <div key={kind} style={{border:"1px solid rgba(255,255,255,.12)",borderRadius:8,padding:8}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,marginBottom:6}}>{label}</div>
            {src ? <img src={src} alt={`${label} evidence`} style={{width:"100%",aspectRatio:"4/3",objectFit:"cover",borderRadius:5}} />
              : <div style={{aspectRatio:"4/3",display:"grid",placeItems:"center",background:"rgba(255,255,255,.03)",fontSize:11,opacity:.65}}>QUEUED / NOT AVAILABLE</div>}
          </div>
        )
      })}
      <div style={{fontSize:11,opacity:.75,gridColumn:"1/-1"}}>
        Evidence completeness: {Math.round(Number(data.completeness||0))}% ·
        confidence: {Math.round(Number(data.confidence||0))}%
      </div>
    </div>
  );
}
