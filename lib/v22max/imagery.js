const enc=encodeURIComponent;
const first=(...vals)=>vals.find(v=>typeof v==="string"&&v.trim())||null;
export function leadImageCandidates(lead={},dbImages=[]){
  const out=[];
  const add=(url,label)=>{if(url&&!out.some(x=>x.url===url))out.push({url,label});};
  dbImages.forEach(i=>add(first(i.enhanced_image_url,i.image_url,i.original_image_url,i.url),i.provider||"Property image"));
  add(first(lead.image_url,lead.primary_image_url,lead.roof_image_url,lead.streetview_url,lead.street_view_url),"Lead image");
  const key=process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY||process.env.GOOGLE_MAPS_API_KEY;
  const addr=[lead.address,lead.city,lead.state||"MN",lead.zip||lead.zip_code||lead.postal_code].filter(Boolean).join(", ");
  if(key&&lead.lat!=null&&lead.lon!=null){
    add(`https://maps.googleapis.com/maps/api/streetview?size=640x420&location=${lead.lat},${lead.lon}&fov=90&pitch=8&key=${key}`,"Google Street View");
    add(`https://maps.googleapis.com/maps/api/staticmap?center=${lead.lat},${lead.lon}&zoom=20&size=640x420&maptype=satellite&markers=${lead.lat},${lead.lon}&key=${key}`,"Google Satellite");
  }else if(key&&addr){
    add(`https://maps.googleapis.com/maps/api/streetview?size=640x420&location=${enc(addr)}&fov=90&pitch=8&key=${key}`,"Google Street View");
    add(`https://maps.googleapis.com/maps/api/staticmap?center=${enc(addr)}&zoom=20&size=640x420&maptype=satellite&markers=${enc(addr)}&key=${key}`,"Google Satellite");
  }
  const mapbox=process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if(mapbox&&lead.lon!=null&&lead.lat!=null)add(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+ffcc00(${lead.lon},${lead.lat})/${lead.lon},${lead.lat},19/640x420?access_token=${mapbox}`,"Mapbox Satellite");
  return out.slice(0,6);
}
