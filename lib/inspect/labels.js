export const DAMAGE_CLASSES = [
  { id: "shingle_loss", label: "Missing / torn shingles", color: "#f5c542" },
  { id: "tarp_or_hole", label: "Tarp or hole / exposed deck", color: "#ff6b4a" },
  { id: "driveway_crack", label: "Cracked / heaved driveway", color: "#7dd3fc" },
  { id: "tree_down", label: "Fallen tree / limb on structure", color: "#86efac" },
  { id: "dead_tree", label: "Dead / dying tree", color: "#c4b5fd" },
];

export const VERDICTS = [
  { id: "verified_lead", label: "Verified lead" },
  { id: "reject", label: "Reject" },
  { id: "needs_drone", label: "Needs drone / close-up" },
];

export function emptyLabelDoc(property, shotKey) {
  return {
    version: 1,
    propertyId: property.id,
    address: property.address,
    lat: property.lat,
    lon: property.lon,
    shotKey,
    source: null,
    gsdNote: "web-tile or street-static — not hail-bruise grade",
    boxes: [],
    verdict: null,
    notes: "",
    labeledAt: null,
  };
}

export function toYoloLines(doc, imgW, imgH) {
  const index = Object.fromEntries(DAMAGE_CLASSES.map((c, i) => [c.id, i]));
  return doc.boxes
    .map((b) => {
      const cls = index[b.classId];
      if (cls == null || imgW <= 0 || imgH <= 0) return null;
      const cx = (b.x + b.w / 2) / imgW;
      const cy = (b.y + b.h / 2) / imgH;
      const nw = b.w / imgW;
      const nh = b.h / imgH;
      return `${cls} ${cx.toFixed(6)} ${cy.toFixed(6)} ${nw.toFixed(6)} ${nh.toFixed(6)}`;
    })
    .filter(Boolean)
    .join("\n");
}
