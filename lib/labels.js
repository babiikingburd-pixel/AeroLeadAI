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

const SAFE_PROPERTY_ID = /^[A-Za-z0-9._-]{1,160}$/;
const SAFE_SHOT_KEY = /^[A-Za-z0-9._-]{1,120}$/;
const CLASS_IDS = new Set(DAMAGE_CLASSES.map((item) => item.id));
const VERDICT_IDS = new Set(VERDICTS.map((item) => item.id));

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

export function labelIdentifiers(input) {
  const propertyId = String(input?.propertyId || "").trim();
  const shotKey = String(input?.shotKey || "").trim();
  if (!SAFE_PROPERTY_ID.test(propertyId)) return { error: "A valid propertyId is required." };
  if (!SAFE_SHOT_KEY.test(shotKey)) return { error: "A valid shotKey is required." };
  return { propertyId, shotKey };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeLabelDocument(body, { now = () => new Date().toISOString(), idFactory } = {}) {
  const ids = labelIdentifiers(body);
  if (ids.error) return ids;

  const rawBoxes = Array.isArray(body.boxes) ? body.boxes.slice(0, 200) : [];
  const boxes = [];
  for (const raw of rawBoxes) {
    const x = finiteNumber(raw?.x);
    const y = finiteNumber(raw?.y);
    const w = finiteNumber(raw?.w);
    const h = finiteNumber(raw?.h);
    if (!CLASS_IDS.has(raw?.classId) || x == null || y == null || w == null || h == null) {
      return { error: "Every box must have a supported class and finite coordinates." };
    }
    if (x < 0 || y < 0 || w <= 0 || h <= 0 || w > 20000 || h > 20000) {
      return { error: "Box coordinates are outside the supported image bounds." };
    }
    const rawId = String(raw.id || "");
    boxes.push({
      id: SAFE_SHOT_KEY.test(rawId) ? rawId : (idFactory ? idFactory() : `box-${boxes.length + 1}`),
      classId: raw.classId,
      x,
      y,
      w,
      h,
    });
  }

  const verdict = body.verdict == null || body.verdict === ""
    ? null
    : VERDICT_IDS.has(body.verdict)
      ? body.verdict
      : undefined;
  if (verdict === undefined) return { error: "Unsupported verdict." };

  const labeledAt = now();
  return {
    propertyId: ids.propertyId,
    shotKey: ids.shotKey,
    doc: {
      version: 1,
      propertyId: ids.propertyId,
      address: String(body.address || "").slice(0, 300),
      lat: finiteNumber(body.lat),
      lon: finiteNumber(body.lon),
      shotKey: ids.shotKey,
      source: String(body.source || "unknown").slice(0, 120),
      gsdNote: String(body.gsdNote || "Web tile or street-static image; not hail-bruise grade.").slice(0, 500),
      boxes,
      verdict,
      notes: String(body.notes || "").slice(0, 5000),
      labeledAt,
    },
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
