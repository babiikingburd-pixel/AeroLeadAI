"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// ---- palette matched to PropertyIntelligenceConsole ----
const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", SIGNAL = "#ef5a6f", MUTE = "#77839a";
const TEXT = "#dfe6ee";

const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const STORE_KEY = "aerolead:batch:v1";

const TEN_YEARS_MS = 10 * 365.25 * 24 * 3600 * 1000;

const DOMAINS = ["roof", "tree", "driveway"];
const DOMAIN_LABELS = { roof: "Roof", tree: "Tree", driveway: "Driveway" };

const SALES_STATUSES = ["new", "contacted", "estimate_scheduled", "won", "lost"];
const SALES_STATUS_LABELS = { new: "New", contacted: "Contacted", estimate_scheduled: "Estimate Scheduled", won: "Won", lost: "Lost" };
const SALES_STATUS_COLORS = { new: MUTE, contacted: BLUE, estimate_scheduled: AMBER, won: GREEN, lost: SIGNAL };

// Best-effort extraction for search/filtering — addresses come from ZIP scan
// (which already knows city/state precisely) or free-typed/CSV text, where
// this is a reasonable guess, not authoritative.
function parseAddressParts(address) {
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\d{5})/);
  const zip = zipMatch ? zipMatch[1] : "";
  const segments = address.split(",").map((s) => s.trim()).filter(Boolean);
  const city = segments.length >= 2 ? segments[segments.length - 2] : "";
  const stateMatch = address.match(/\b([A-Z]{2})\b\s*\d{5}/);
  const state = stateMatch ? stateMatch[1] : "";
  return { city, state, zip };
}

// Queue durability: if Supabase is configured, the queue (addresses, scores,
// permit status — NOT images, which stay client-side) syncs there instead of
// living only in this browser's localStorage. See supabase_batch_leads_schema.sql.
const SUPABASE_URL = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_URL : null;
const SUPABASE_ANON_KEY = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY : null;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function combinedScore(item) {
  const scores = DOMAINS.map((d) => item.scores?.[d]?.score).filter((s) => s !== null && s !== undefined);
  return scores.length ? Math.max(...scores) : null;
}

function tierOf(item) {
  // Business rule (stated): any property with a permit pulled in the last ten
  // years is low priority — this overrides the damage score entirely.
  if (item.permitWithin10y) return "low-priority";
  const s = combinedScore(item);
  if (s === null) return "unscored";
  if (s >= 75) return "hot";
  if (s >= 50) return "warm";
  if (s >= 25) return "cool";
  return "cold";
}

const TIER_COLORS = { hot: SIGNAL, warm: AMBER, cool: BLUE, cold: MUTE, "low-priority": "#8a6bd1", unscored: MUTE };

function blankItem(address, extra = {}) {
  const parsed = parseAddressParts(address);
  return {
    id: uid(),
    address,
    lat: null,
    lon: null,
    images: { roof: null, tree: null, driveway: null },
    imageryMeta: null, // { provider, cached, cachedAt, resolution, capturedDate }
    scores: { roof: null, tree: null, driveway: null },
    permitWithin10y: false,
    permitNotes: "Not checked",
    stage: "queued",
    salesStatus: "new",
    owner: "",
    notes: "",
    tags: [],
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    log: [],
    ...extra,
  };
}

function itemToRow(item) {
  return {
    id: item.id,
    address: item.address,
    lat: item.lat ? Number(item.lat) : null,
    lon: item.lon ? Number(item.lon) : null,
    stage: item.stage,
    roof_score: item.scores.roof?.score ?? null,
    tree_score: item.scores.tree?.score ?? null,
    driveway_score: item.scores.driveway?.score ?? null,
    damage_notes: {
      roof: item.scores.roof?.notes ?? null,
      tree: item.scores.tree?.notes ?? null,
      driveway: item.scores.driveway?.notes ?? null,
    },
    permit_within_10y: item.permitWithin10y,
    permit_notes: item.permitNotes,
    sales_status: item.salesStatus || "new",
    owner: item.owner || null,
    notes: item.notes || null,
    tags: item.tags && item.tags.length ? item.tags : [],
    city: item.city || null,
    state: item.state || null,
    zip: item.zip || null,
    updated_at: nowIso(),
  };
}

function rowToItem(row) {
  return {
    id: row.id,
    address: row.address,
    lat: row.lat ?? null,
    lon: row.lon ?? null,
    images: { roof: null, tree: null, driveway: null }, // images aren't persisted server-side; pipeline re-fetches on demand
    imageryMeta: null,
    scores: {
      roof: row.roof_score !== null ? { score: row.roof_score, notes: row.damage_notes?.roof || "", provider: null } : null,
      tree: row.tree_score !== null ? { score: row.tree_score, notes: row.damage_notes?.tree || "", provider: null } : null,
      driveway: row.driveway_score !== null ? { score: row.driveway_score, notes: row.damage_notes?.driveway || "", provider: null } : null,
    },
    permitWithin10y: !!row.permit_within_10y,
    permitNotes: row.permit_notes || "Not checked",
    stage: row.stage || "done",
    salesStatus: row.sales_status || "new",
    owner: row.owner || "",
    notes: row.notes || "",
    tags: row.tags || [],
    city: row.city || "",
    state: row.state || "",
    zip: row.zip || "",
    log: ["Loaded from Supabase directory"],
  };
}

export default function MassUploadConsole() {
  const [items, setItems] = useState({});
  const [order, setOrder] = useState([]);
  const [addressText, setAddressText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [editor, setEditor] = useState(null); // { itemId, domain }
  const [historyFor, setHistoryFor] = useState(null); // itemId
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const fileRef = useRef(null);

  // ---- persistence: Supabase (durable, cross-device) if configured, else localStorage ----
  useEffect(() => {
    (async () => {
      if (supabase) {
        try {
          const { data, error } = await supabase.from("batch_leads").select("*").order("updated_at", { ascending: false }).limit(500);
          if (!error && data) {
            const nextItems = {}, nextOrder = [];
            data.forEach((row) => {
              const it = rowToItem(row);
              nextItems[it.id] = it;
              nextOrder.push(it.id);
            });
            setItems(nextItems);
            setOrder(nextOrder.reverse());
            return;
          }
        } catch {}
      }
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          setItems(saved.items || {});
          setOrder(saved.order || []);
        }
      } catch {}
    })();
  }, []);

  // Safe write: if images push us over the ~5MB quota, retry storing metadata
  // only (drop images) so scores/addresses always persist even for big batches.
  function safeStore(nextItems, nextOrder) {
    const payload = { items: nextItems, order: nextOrder };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch {
      try {
        const stripped = {};
        for (const k in nextItems) stripped[k] = { ...nextItems[k], images: { roof: null, tree: null, driveway: null } };
        localStorage.setItem(STORE_KEY, JSON.stringify({ items: stripped, order: nextOrder }));
      } catch {}
    }
  }

  function syncToSupabase(item) {
    if (!supabase) return;
    supabase.from("batch_leads").upsert(itemToRow(item)).then(() => {}).catch(() => {});
  }

  const persist = useCallback((nextItems, nextOrder) => {
    setItems(nextItems);
    setOrder(nextOrder);
    safeStore(nextItems, nextOrder);
  }, []);

  function upsert(item) {
    setItems((prev) => {
      const next = { ...prev, [item.id]: item };
      setOrder((po) => {
        const no = po.includes(item.id) ? po : [...po, item.id];
        safeStore(next, no);
        return no;
      });
      return next;
    });
    syncToSupabase(item);
  }

  // ---- intake: paste addresses ----
  // ---- intake: CSV file (first column = address, optional lat/lon columns) ----
  const csvRef = useRef(null);
  function handleCsv(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split("\n").map((l) => l.trim()).filter(Boolean);
      lines.forEach((line, idx) => {
        const cols = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
        if (idx === 0 && /address/i.test(cols[0])) return; // header row
        if (!cols[0]) return;
        const maybeLat = parseFloat(cols[1]), maybeLon = parseFloat(cols[2]);
        upsert(blankItem(cols[0], {
          lat: Number.isFinite(maybeLat) ? cols[1] : null,
          lon: Number.isFinite(maybeLon) ? cols[2] : null,
          log: ["Imported from CSV"],
        }));
      });
    };
    reader.readAsText(file);
  }

  // ---- promote a lead to the deep-dive console ----
  function promoteToDeepDive(it) {
    try {
      const raw = localStorage.getItem("propintel:properties");
      const props = raw ? JSON.parse(raw) : {};
      const id = uid();
      const images = DOMAINS.filter((d) => it.images[d]).map((d) => ({
        id: uid(), domain: d, dataUrl: it.images[d].dataUrl, mediaType: it.images[d].mediaType, uploadedAt: nowIso(),
      }));
      const scoredDomains = DOMAINS.filter((d) => it.scores[d]);
      props[id] = {
        id, address: it.address, lat: it.lat || "", lon: it.lon || "",
        parcelId: "", permitId: "", roofType: "", buildingAge: "", roofPitch: "",
        createdAt: nowIso(),
        folders: {
          images, drone: [], street: [], historical: [], weather: [],
          permits: it.permitNotes && it.permitNotes !== "Not checked" ? [{ id: uid(), text: `[From batch] ${it.permitNotes}`, at: nowIso() }] : [],
          inspectionReports: [], contractorNotes: [],
          aiFindings: scoredDomains.length ? [{
            id: uid(), at: nowIso(),
            results: scoredDomains.map((d) => ({ domain: d, concern_score: it.scores[d].score, notes: it.scores[d].notes })),
            findingsScore: combinedScore(it),
          }] : [],
          repairs: [], timeline: [{ id: uid(), at: nowIso(), text: "Promoted from batch pipeline" }],
        },
        findingsScore: combinedScore(it), suggestedActions: [],
      };
      localStorage.setItem("propintel:properties", JSON.stringify(props));
      upsert({ ...it, log: [...it.log, "Promoted to deep-dive console"] });
      window.location.href = "/";
    } catch (e) {
      alert("Promote failed: " + e.message);
    }
  }

  // ---- intake: ZIP code scan ----
  const [zipInput, setZipInput] = useState("");
  const [zipMax, setZipMax] = useState(50);
  const [zipScanning, setZipScanning] = useState(false);
  const [zipResult, setZipResult] = useState(null);

  async function scanZip() {
    if (!zipInput.trim()) return;
    setZipScanning(true);
    setZipResult(null);
    try {
      const res = await fetch(`/api/zip-scan?zip=${zipInput.trim()}&max=${zipMax}`);
      const data = await res.json();
      if (!data.ok) { setZipResult({ error: data.error, debug: data.debug }); setZipScanning(false); return; }
      data.addresses.forEach((a) => {
        upsert(blankItem(a.address, {
          lat: a.lat || null, lon: a.lon || null,
          city: data.city || "", state: data.state || "", zip: data.zip || "",
          log: [`Imported from ZIP ${data.zip} scan`],
        }));
      });
      setZipResult({ count: data.count, city: data.city, state: data.state });
    } catch (e) {
      setZipResult({ error: e.message });
    }
    setZipScanning(false);
  }

  function queueAddresses() {
    const lines = addressText.split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((address) => upsert(blankItem(address)));
    setAddressText("");
  }

  // ---- intake: drop/select images (address optional, editable inline; tagged as roof by default) ----
  function handleFiles(fileList) {
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        upsert(blankItem(file.name.replace(/\.[a-z]+$/i, ""), {
          images: { roof: { dataUrl: reader.result, mediaType: file.type, source: "manual upload" }, tree: null, driveway: null },
        }));
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- pipeline stages ----
  async function geocode(item) {
    if (item.lat && item.lon) return item;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(item.address)}`, { headers: { "Accept-Language": "en" } });
      const data = await res.json();
      if (data?.length) return { ...item, lat: data[0].lat, lon: data[0].lon, log: [...item.log, "Geocoded via OSM"] };
      return { ...item, log: [...item.log, "Geocode: no match"] };
    } catch { return { ...item, log: [...item.log, "Geocode failed"] }; }
  }

  async function fetchImagery(item, force = false) {
    const needsAny = force || DOMAINS.some((d) => !item.images[d]);
    if (!needsAny || !item.lat || !item.lon) return item;
    try {
      const res = await fetch("/api/imagery-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: item.lat, lon: item.lon, force }) });
      const data = await res.json();
      if (data.error) return { ...item, log: [...item.log, data.notes || data.error] };

      const angles = data.angles || {};
      const roofline = Object.entries(angles).filter(([k]) => k.includes("roofline")).map(([, v]) => v);
      const images = force ? { roof: null, tree: null, driveway: null } : { ...item.images };

      // One imagery-agent call returns several distinct vantage points — assign
      // the tight parcel crop + roofline street shots to roof, the hybrid
      // road/label overlay (or wider context shot) to driveway, and the context
      // shot to tree, instead of discarding everything but one image like before.
      // Every domain falls back through whatever angle IS available (tight can
      // fail independently of context under concurrent load on the free Esri
      // tier — seen in practice — so roof needs the same fallback chain the
      // other two domains already had, or a flaky tight fetch means roof silently
      // gets no image while tree/driveway do).
      if (!images.roof) {
        const src = angles.overview_tight || data.dataUrl || angles.overview_context;
        if (src) images.roof = { dataUrl: src, mediaType: "image/jpeg", source: `auto (${data.provider})`, extra: roofline };
      }
      if (!images.driveway) {
        const src = angles.overview_hybrid_labeled || angles.overview_context || angles.overview_tight || data.dataUrl;
        if (src) images.driveway = { dataUrl: src, mediaType: "image/jpeg", source: `auto (${data.provider})` };
      }
      if (!images.tree) {
        const src = angles.overview_context || angles.overview_tight || data.dataUrl;
        if (src) images.tree = { dataUrl: src, mediaType: "image/jpeg", source: `auto (${data.provider})` };
      }

      const gotCount = DOMAINS.filter((d) => images[d]).length;
      const imageryMeta = { provider: data.provider, cached: !!data.cached, cachedAt: data.cachedAt || null, resolution: data.resolution || {}, capturedDate: data.capturedDate || null, fetchedAt: nowIso() };
      return { ...item, images, imageryMeta, log: [...item.log, `Imagery ${data.cached ? "loaded from cache" : "auto-fetched"} (${data.provider}) — ${gotCount}/3 domain image(s) ready`] };
    } catch { return { ...item, log: [...item.log, "Imagery fetch failed"] }; }
  }

  async function refreshImagery(it) {
    const updated = await fetchImagery(it, true);
    upsert({ ...updated, scores: { roof: null, tree: null, driveway: null }, stage: "queued", log: [...updated.log, "Imagery force-refreshed — re-run pipeline to rescore"] });
  }

  async function checkPermits(item) {
    try {
      const res = await fetch(`/api/permit-lookup?address=${encodeURIComponent(item.address)}`);
      const data = await res.json();
      if (data.ok && data.inDirectory && data.records?.length) {
        const cutoff = Date.now() - TEN_YEARS_MS;
        const recent = data.records.find((r) => r.issue_date && new Date(r.issue_date).getTime() >= cutoff);
        if (recent) {
          return { ...item, permitWithin10y: true, permitNotes: `Permit ${recent.issue_date} (${recent.permit_type || "type unknown"}) — inside 10-year window → LOW PRIORITY`, log: [...item.log, "Permit within 10 years → deprioritized"] };
        }
        return { ...item, permitWithin10y: false, permitNotes: `${data.records.length} record(s), none within 10 years`, log: [...item.log, "Permits found, all older than 10y"] };
      }
      return { ...item, permitNotes: data.notes || "Not in directory", log: [...item.log, "No directory permit hit"] };
    } catch { return { ...item, permitNotes: "Permit lookup failed", log: [...item.log, "Permit lookup failed"] }; }
  }

  function toImagePayload(dataUrl) {
    const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.*)$/);
    if (!m) return null;
    return { base64Image: m[2], mediaType: m[1] };
  }

  async function runDamageForDomain(item, domain) {
    const imgObj = item.images[domain];
    if (!imgObj) return null;
    const primary = toImagePayload(imgObj.dataUrl);
    if (!primary) return { score: null, notes: "Unreadable image data", provider: null };
    const extras = (imgObj.extra || []).map(toImagePayload).filter(Boolean);
    const images = [primary, ...extras];
    try {
      const res = await fetch("/api/damage-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, images, address: item.address }),
      });
      const data = await res.json();
      if (data.error) return { score: null, notes: data.error, provider: null };
      return { score: data.concern_score, notes: `${data.notes || ""} [${data.provider}, ${images.length} angle(s)]`, provider: data.provider };
    } catch (e) {
      return { score: null, notes: "Vision call failed: " + e.message, provider: null };
    }
  }

  async function runDamage(item) {
    if (item.permitWithin10y) return { ...item, log: [...item.log, "Skipped vision (10-year permit rule)"] };
    const scores = { ...item.scores };
    const logs = [];
    for (const domain of DOMAINS) {
      if (!item.images[domain]) { logs.push(`${DOMAIN_LABELS[domain]}: no image — manual review`); continue; }
      const r = await runDamageForDomain(item, domain);
      if (!r) continue;
      scores[domain] = r.score !== null ? { score: r.score, notes: r.notes, provider: r.provider } : null;
      logs.push(r.score !== null ? `${DOMAIN_LABELS[domain]} scored ${r.score}` : `${DOMAIN_LABELS[domain]}: vision error — ${r.notes}`);
    }
    return { ...item, scores, log: [...item.log, ...logs] };
  }

  // keep refs so runAll reads current state mid-loop
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const orderRef = useRef(order);
  useEffect(() => { orderRef.current = order; }, [order]);

  const CONCURRENCY = 3;

  async function processOne(id) {
    let it = { ...itemsRef.current[id], stage: "processing" };
    upsert(it);
    it = await geocode(it); upsert(it);
    it = await fetchImagery(it); upsert(it);
    it = await checkPermits(it); upsert(it);
    it = await runDamage(it);
    it = { ...it, stage: "done" };
    upsert(it);
  }

  async function runAll() {
    setRunning(true);
    const ids = orderRef.current.filter((id) => itemsRef.current[id] && itemsRef.current[id].stage !== "done");
    let done = 0;
    const queue = [...ids];
    async function worker() {
      while (queue.length) {
        const id = queue.shift();
        await processOne(id);
        done++;
        setProgress(`${done}/${ids.length} processed`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    setProgress("");
    setRunning(false);
  }

  // ---- true autonomy: auto-run anything that lands in the queue ----
  const [autoRun, setAutoRun] = useState(false);
  const autoBusy = useRef(false);
  useEffect(() => {
    if (!autoRun || autoBusy.current) return;
    const pending = order.filter((id) => items[id]?.stage === "queued");
    if (!pending.length) return;
    autoBusy.current = true;
    (async () => {
      setRunning(true);
      for (const id of pending) {
        if (itemsRef.current[id]?.stage === "queued") await processOne(id);
      }
      setRunning(false);
      autoBusy.current = false;
    })();
  }, [autoRun, order, items]); // eslint-disable-line react-hooks/exhaustive-deps

  function retryFailed() {
    order.forEach((id) => {
      const it = items[id];
      if (it && it.stage === "done" && !it.permitWithin10y && combinedScore(it) === null) {
        upsert({ ...it, stage: "queued", log: [...it.log, "Re-queued for retry"] });
      }
    });
  }

  function removeItem(id) {
    const next = { ...items }; delete next[id];
    persist(next, order.filter((o) => o !== id));
    if (supabase) supabase.from("batch_leads").delete().eq("id", id).then(() => {}).catch(() => {});
  }

  function exportRows() {
    return order.map((id) => items[id]).filter(Boolean).map((it) => ({
      tier: tierOf(it), status: SALES_STATUS_LABELS[it.salesStatus] || it.salesStatus,
      address: it.address, owner: it.owner || "", city: it.city || "", state: it.state || "", zip: it.zip || "",
      lat: it.lat || "", lon: it.lon || "",
      roof_score: it.scores.roof?.score ?? "", tree_score: it.scores.tree?.score ?? "", driveway_score: it.scores.driveway?.score ?? "",
      permit_within_10y: it.permitWithin10y, permit_notes: it.permitNotes,
      tags: (it.tags || []).join("; "), notes: it.notes || "",
    }));
  }

  function exportCsv() {
    const rows = exportRows();
    if (!rows.length) return;
    const header = Object.keys(rows[0]);
    const csv = [header.join(",")].concat(rows.map((r) => header.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "aeroleadai_batch.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  async function exportExcel() {
    const rows = exportRows();
    if (!rows.length) return;
    const XLSX = await import("xlsx"); // lazy-loaded — keeps the initial page bundle lean since most sessions never export
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    XLSX.writeFile(wb, "aeroleadai_batch.xlsx");
  }

  function updateLead(it, patch) {
    upsert({ ...it, ...patch });
  }

  // ---- sorted + filtered view: hot first, low-priority last ----
  const tierRank = { hot: 0, warm: 1, cool: 2, cold: 3, unscored: 4, "low-priority": 5 };
  const searchLower = search.trim().toLowerCase();
  const sorted = order
    .map((id) => items[id])
    .filter(Boolean)
    .filter((it) => statusFilter === "all" || (it.salesStatus || "new") === statusFilter)
    .filter((it) => {
      if (!searchLower) return true;
      return [it.address, it.owner, it.city, it.state, it.zip].some((f) => (f || "").toLowerCase().includes(searchLower));
    })
    .sort((a, b) => tierRank[tierOf(a)] - tierRank[tierOf(b)]);

  function updateDomainImage(itemId, domain, dataUrl) {
    const it = items[itemId];
    if (!it) return;
    const nextImages = { ...it.images, [domain]: { ...it.images[domain], dataUrl } };
    const nextScores = { ...it.scores, [domain]: null };
    upsert({ ...it, images: nextImages, scores: nextScores, stage: "queued", log: [...it.log, `${DOMAIN_LABELS[domain]} image enhanced/edited — re-run pipeline to rescore`] });
  }

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "28px 36px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Mass Upload — Autonomous Batch Pipeline</h1>
          <p style={{ color: MUTE, fontSize: 13, margin: "6px 0 0", maxWidth: 680 }}>
            Paste addresses or drop images. One click runs everything: geocode → satellite imagery (roof + tree + driveway) → permit directory check (10-year rule) → damage vision across all 3 domains → ranked output.
          </p>
          <p style={{ color: supabase ? GREEN : MUTE, fontSize: 11.5, margin: "6px 0 0" }}>
            {supabase ? "✓ Queue synced to Supabase — durable across devices/sessions." : "Queue stored locally in this browser only. Set NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (see supabase_batch_leads_schema.sql) for a durable, cross-device queue."}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/map" style={{ padding: "8px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: GREEN, fontSize: 13, textDecoration: "none" }}>🗺 View map</a>
          <a href="/" style={{ padding: "8px 14px", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 13, textDecoration: "none" }}>Deep-dive console →</a>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: autoRun ? GREEN : MUTE, cursor: "pointer", border: `1px solid ${autoRun ? GREEN : LINE}`, borderRadius: 6, padding: "8px 12px" }}>
            <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} style={{ margin: 0 }} />
            Auto-run new items
          </label>
          <button onClick={retryFailed} style={btnSecondary}>Retry failed</button>
          <button onClick={() => csvRef.current?.click()} style={btnSecondary}>Import CSV</button>
          <input ref={csvRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={(e) => { handleCsv(e.target.files[0]); e.target.value = ""; }} />
          <button onClick={exportCsv} style={btnSecondary}>Export CSV</button>
          <button onClick={exportExcel} style={btnSecondary}>Export Excel</button>
          <button onClick={runAll} disabled={running || !order.length} style={{ ...btnPrimary, opacity: running || !order.length ? 0.5 : 1 }}>
            {running ? "Running…" : `Run pipeline (${order.filter((id) => items[id]?.stage !== "done").length})`}
          </button>
        </div>
      </div>

      <StatsStrip items={items} order={order} />

      {progress && <div style={{ color: AMBER, fontSize: 12, marginBottom: 12, fontFamily: "monospace" }}>▶ {progress}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 22 }}>
        <div style={panel}>
          <div style={panelTitle}>ZIP Code Scanner</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              value={zipInput}
              onChange={(e) => setZipInput(e.target.value.replace(/\D/g, "").slice(0, 5))}
              onKeyDown={(e) => e.key === "Enter" && scanZip()}
              placeholder="55407"
              maxLength={5}
              style={{ flex: 1, background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: "8px 10px", fontSize: 16, fontFamily: "monospace" }}
            />
            <select value={zipMax} onChange={(e) => setZipMax(Number(e.target.value))} style={{ background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
          <button onClick={scanZip} disabled={zipScanning || zipInput.length !== 5} style={{ ...btnPrimary, width: "100%", opacity: zipScanning || zipInput.length !== 5 ? 0.5 : 1 }}>
            {zipScanning ? "Scanning ZIP…" : "Scan ZIP code"}
          </button>
          {zipResult && (
            <div style={{ marginTop: 8, fontSize: 12, color: zipResult.error ? SIGNAL : GREEN }}>
              {zipResult.error ? `Error: ${zipResult.error}` : `✓ Queued ${zipResult.count} addresses in ${zipResult.city}, ${zipResult.state}`}
            </div>
          )}
          {zipResult?.debug && (
            <div style={{ marginTop: 6, fontSize: 10.5, color: MUTE, fontFamily: "monospace", lineHeight: 1.6 }}>
              {zipResult.debug.map((d, i) => <div key={i}>· {d}</div>)}
            </div>
          )}
        </div>
        <div style={panel}>
          <div style={panelTitle}>Addresses (one per line)</div>
          <textarea value={addressText} onChange={(e) => setAddressText(e.target.value)} rows={5} placeholder={"4243 13th Ave S, Minneapolis, MN\n123 Main St, Shakopee, MN\n…"} style={{ width: "100%", background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: 10, fontSize: 13, fontFamily: "monospace", boxSizing: "border-box", resize: "vertical" }} />
          <button onClick={queueAddresses} disabled={!addressText.trim()} style={{ ...btnPrimary, marginTop: 8, opacity: addressText.trim() ? 1 : 0.5 }}>Queue addresses</button>
        </div>
        <div
          style={{ ...panel, border: `1.5px dashed ${LINE}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", color: MUTE }}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        >
          <div style={{ fontSize: 26, marginBottom: 6 }}>⇪</div>
          <div style={{ fontSize: 13 }}>Drop roof images here (multi-select), or click to choose.<br />Filename becomes the address — edit it inline after.</div>
          <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
        </div>
      </div>

      {order.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by address, owner, city, or ZIP…"
            style={{ flex: "1 1 260px", background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: "8px 10px", fontSize: 13 }}
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: "8px 10px", fontSize: 13 }}>
            <option value="all">All statuses</option>
            {SALES_STATUSES.map((s) => <option key={s} value={s}>{SALES_STATUS_LABELS[s]}</option>)}
          </select>
          <span style={{ fontSize: 12, color: MUTE }}>{sorted.length} of {order.length} lead(s)</span>
        </div>
      )}

      {!sorted.length && <div style={{ color: MUTE, textAlign: "center", padding: 40 }}>{order.length ? "No leads match your search/filter." : "Nothing queued yet."}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {sorted.map((it) => (
          <LeadCard
            key={it.id}
            it={it}
            tier={tierOf(it)}
            onUpdate={(patch) => updateLead(it, patch)}
            onRemove={() => removeItem(it.id)}
            onPromote={() => promoteToDeepDive(it)}
            onEdit={(domain) => setEditor({ itemId: it.id, domain })}
            onRefreshImagery={() => refreshImagery(it)}
            onShowHistory={() => setHistoryFor(it.id)}
            supabaseConfigured={!!supabase}
          />
        ))}
      </div>

      {editor && items[editor.itemId]?.images[editor.domain] && (
        <ImageEditor
          item={items[editor.itemId]}
          domain={editor.domain}
          onClose={() => setEditor(null)}
          onSave={(newDataUrl) => { updateDomainImage(editor.itemId, editor.domain, newDataUrl); setEditor(null); }}
        />
      )}

      {historyFor && items[historyFor] && (
        <ImageryHistoryModal item={items[historyFor]} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
}

function LeadCard({ it, tier, onUpdate, onRemove, onPromote, onEdit, onRefreshImagery, onShowHistory, supabaseConfigured }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (!(it.tags || []).includes(t)) onUpdate({ tags: [...(it.tags || []), t] });
    setTagInput("");
  }
  function removeTag(t) {
    onUpdate({ tags: (it.tags || []).filter((x) => x !== t) });
  }

  return (
    <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: LINE }}>
          {DOMAINS.map((domain) => {
            const img = it.images[domain];
            const score = it.scores[domain]?.score;
            const res = it.imageryMeta?.resolution?.[domain === "roof" ? "overview_tight" : domain === "driveway" ? "overview_hybrid_labeled" : "overview_context"] || it.imageryMeta?.resolution?.overview_tight;
            const title = img ? [
              it.imageryMeta?.provider ? `Provider: ${it.imageryMeta.provider}` : null,
              res?.metersPerPixel ? `Resolution: ~${res.metersPerPixel.toFixed(3)} m/px` : null,
              it.imageryMeta?.cached ? `Cached (fetched ${new Date(it.imageryMeta.cachedAt).toLocaleDateString()})` : "Freshly fetched",
              "Capture date not exposed by this provider's static tile API",
            ].filter(Boolean).join(" · ") : "";
            return (
              <div key={domain} style={{ position: "relative", height: 96, background: PANEL2 }} title={title}>
                {img
                  ? <img src={img.dataUrl} alt={domain} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: MUTE, fontSize: 10, textAlign: "center", padding: 4 }}>{it.stage === "done" ? "No image" : "Awaiting"}</div>}
                <span style={{ position: "absolute", top: 4, left: 4, padding: "2px 6px", borderRadius: 10, fontSize: 9, fontWeight: 700, background: "rgba(13,20,32,.85)", color: TEXT }}>{DOMAIN_LABELS[domain]}</span>
                {score !== null && score !== undefined && (
                  <span style={{ position: "absolute", top: 4, right: 4, padding: "2px 6px", borderRadius: 10, fontSize: 9, fontWeight: 700, background: "rgba(13,20,32,.85)", color: score >= 75 ? SIGNAL : score >= 50 ? AMBER : score >= 25 ? BLUE : MUTE }}>{score}</span>
                )}
                {img && (
                  <button onClick={() => onEdit(domain)} style={{ position: "absolute", bottom: 4, right: 4, padding: "2px 6px", background: "rgba(13,20,32,.85)", border: `1px solid ${LINE}`, borderRadius: 5, color: BLUE, fontSize: 9.5, cursor: "pointer" }}>
                    Edit
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <span style={{ position: "absolute", top: 8, left: 8, padding: "3px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", background: "rgba(13,20,32,.85)", color: TIER_COLORS[tier] }}>{tier}</span>
        <button onClick={onRemove} style={{ position: "absolute", top: 6, right: 6, background: "rgba(13,20,32,.8)", border: "none", color: TEXT, width: 22, height: 22, borderRadius: "50%", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
        {it.imageryMeta?.cached && (
          <span style={{ position: "absolute", bottom: 4, left: 4, padding: "2px 7px", borderRadius: 10, fontSize: 9, background: "rgba(13,20,32,.85)", color: GREEN }}>cached</span>
        )}
      </div>
      <div style={{ padding: "10px 12px" }}>
        <input
          value={it.address}
          onChange={(e) => onUpdate({ address: e.target.value })}
          style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${LINE}`, color: TEXT, fontSize: 13, fontWeight: 600, padding: "2px 0", marginBottom: 6, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <select
            value={it.salesStatus || "new"}
            onChange={(e) => onUpdate({ salesStatus: e.target.value })}
            style={{ flex: 1, background: PANEL2, border: `1px solid ${SALES_STATUS_COLORS[it.salesStatus] || LINE}`, color: SALES_STATUS_COLORS[it.salesStatus] || TEXT, borderRadius: 6, padding: "4px 6px", fontSize: 11, fontWeight: 700 }}
          >
            {SALES_STATUSES.map((s) => <option key={s} value={s}>{SALES_STATUS_LABELS[s]}</option>)}
          </select>
          <button onClick={() => setDetailsOpen((v) => !v)} style={{ ...btnSecondary, padding: "4px 8px", fontSize: 11 }}>{detailsOpen ? "Hide" : "Notes/Tags"}</button>
        </div>
        {detailsOpen && (
          <div style={{ marginBottom: 8, padding: 8, background: PANEL2, borderRadius: 6, border: `1px solid ${LINE}` }}>
            <input
              value={it.owner || ""}
              onChange={(e) => onUpdate({ owner: e.target.value })}
              placeholder="Owner name (optional)"
              style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${LINE}`, color: TEXT, fontSize: 11.5, padding: "3px 0", marginBottom: 6, boxSizing: "border-box" }}
            />
            <textarea
              value={it.notes || ""}
              onChange={(e) => onUpdate({ notes: e.target.value })}
              placeholder="Notes…"
              rows={2}
              style={{ width: "100%", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, fontSize: 11.5, padding: 5, marginBottom: 6, boxSizing: "border-box", resize: "vertical" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
              {(it.tags || []).map((t) => (
                <span key={t} onClick={() => removeTag(t)} title="Click to remove" style={{ cursor: "pointer", fontSize: 10, padding: "2px 7px", borderRadius: 10, background: PANEL, border: `1px solid ${LINE}`, color: TEXT }}>{t} ×</span>
              ))}
            </div>
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="Add tag, press Enter"
              style={{ width: "100%", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 4, color: TEXT, fontSize: 11, padding: "4px 6px", boxSizing: "border-box" }}
            />
          </div>
        )}
        <div style={{ fontSize: 11.5, color: MUTE, lineHeight: 1.5 }}>
          <div title={it.permitNotes}>Permit: {it.permitWithin10y ? <b style={{ color: "#8a6bd1" }}>within 10y → low priority</b> : it.permitNotes}</div>
          <div style={{ fontFamily: "monospace", fontSize: 10.5 }}>{it.lat && it.lon ? `${Number(it.lat).toFixed(4)}, ${Number(it.lon).toFixed(4)}` : "no coords"} · {it.stage}{it.zip ? ` · ${it.zip}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button onClick={onRefreshImagery} disabled={!it.lat || !it.lon} style={{ ...btnSecondary, flex: 1, padding: "6px 0", fontSize: 11.5, opacity: it.lat && it.lon ? 1 : 0.5 }}>↻ Refresh imagery</button>
          <button onClick={onShowHistory} disabled={!supabaseConfigured} title={supabaseConfigured ? "Compare imagery over time" : "Requires Supabase for imagery history"} style={{ ...btnSecondary, flex: 1, padding: "6px 0", fontSize: 11.5, opacity: supabaseConfigured ? 1 : 0.5 }}>🕐 History</button>
        </div>
        {it.stage === "done" && !it.permitWithin10y && (
          <button onClick={onPromote} style={{ ...btnSecondary, width: "100%", marginTop: 8, padding: "6px 0", fontSize: 12, color: GREEN, borderColor: GREEN }}>
            Promote to deep-dive →
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Before/after imagery comparison, sourced from imagery_history (Supabase) ----
function ImageryHistoryModal({ item, onClose }) {
  const [snapshots, setSnapshots] = useState(null); // null = loading
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(1);

  useEffect(() => {
    if (!item.lat || !item.lon) { setSnapshots([]); return; }
    fetch(`/api/imagery-agent?lat=${item.lat}&lon=${item.lon}`)
      .then((r) => r.json())
      .then((data) => setSnapshots(data.ok ? data.snapshots : []))
      .catch(() => setSnapshots([]));
  }, [item.lat, item.lon]);

  const picFor = (snap) => snap?.angles?.overview_tight || snap?.angles?.overview_context || null;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,14,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, width: 820, maxWidth: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <b style={{ fontSize: 14 }}>Imagery History — {item.address}</b>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTE, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {snapshots === null && <div style={{ color: MUTE, fontSize: 13, padding: 20, textAlign: "center" }}>Loading history…</div>}
        {snapshots && snapshots.length < 2 && (
          <div style={{ color: MUTE, fontSize: 13, padding: 20, textAlign: "center" }}>
            Not enough history yet for this property ({snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"} on file). Snapshots accumulate each time imagery is freshly fetched (cache misses or "↻ Refresh imagery"), roughly every 30 days per property.
          </div>
        )}
        {snapshots && snapshots.length >= 2 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[{ idx: leftIdx, set: setLeftIdx }, { idx: rightIdx, set: setRightIdx }].map((col, i) => (
                <div key={i}>
                  <select value={col.idx} onChange={(e) => col.set(Number(e.target.value))} style={{ width: "100%", background: PANEL2, border: `1px solid ${LINE}`, color: TEXT, borderRadius: 6, padding: "6px 8px", fontSize: 12, marginBottom: 6 }}>
                    {snapshots.map((s, si) => <option key={si} value={si}>{new Date(s.fetched_at).toLocaleString()} ({s.provider})</option>)}
                  </select>
                  {picFor(snapshots[col.idx])
                    ? <img src={picFor(snapshots[col.idx])} alt="" style={{ width: "100%", borderRadius: 8, background: "#000" }} />
                    : <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: MUTE, fontSize: 12, background: PANEL2, borderRadius: 8 }}>No image in this snapshot</div>}
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11, color: MUTE, marginTop: 10, marginBottom: 0 }}>Comparing the tight parcel crop from each snapshot. Capture-date metadata isn't exposed by these providers' static-tile APIs — dates shown are when AeroLeadAI fetched the image, not when the underlying satellite pass occurred.</p>
          </>
        )}
      </div>
    </div>
  );
}

function StatsStrip({ items, order }) {
  const all = order.map((id) => items[id]).filter(Boolean);
  const counts = { hot: 0, warm: 0, cool: 0, cold: 0, "low-priority": 0, unscored: 0 };
  all.forEach((it) => { counts[tierOf(it)]++; });
  const doneCount = all.filter((it) => it.stage === "done").length;
  const scored = all.map((it) => combinedScore(it)).filter((s) => s !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, v) => s + v, 0) / scored.length) : "—";
  const fullImagery = all.filter((it) => DOMAINS.every((d) => it.images[d])).length;
  const cells = [
    ["Hot", counts.hot, SIGNAL], ["Warm", counts.warm, AMBER], ["Cool", counts.cool, BLUE], ["Cold", counts.cold, MUTE],
    ["Low priority (10y rule)", counts["low-priority"], "#8a6bd1"], ["Avg damage", avg, TEXT],
    ["3/3 imagery", `${fullImagery}/${all.length}`, TEXT], ["Processed", `${doneCount}/${all.length}`, TEXT],
  ];
  if (!all.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 18 }}>
      {cells.map(([label, value, color]) => (
        <div key={label} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 14px" }}>
          <div style={{ fontFamily: "monospace", fontSize: 20, fontWeight: 700, color }}>{value}</div>
          <div style={{ fontSize: 10.5, color: MUTE, textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Zoom / Edit / Enhance modal — pure canvas, no dependencies ----
function ImageEditor({ item, domain, onClose, onSave }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [sharpen, setSharpen] = useState(false);
  const dragRef = useRef(null);
  const dataUrl = item.images[domain].dataUrl;

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; draw(); };
    img.src = dataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.max(canvas.width / img.width, canvas.height / img.height) * zoom;
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2 + offset.x, (canvas.height - h) / 2 + offset.y, w, h);
    ctx.filter = "none";
    if (sharpen) applySharpen(ctx, canvas.width, canvas.height);
  }, [zoom, offset, brightness, contrast, saturation, sharpen]);

  useEffect(() => { draw(); }, [draw]);

  function applySharpen(ctx, w, h) {
    const src = ctx.getImageData(0, 0, w, h);
    const dst = ctx.createImageData(w, h);
    const k = [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0];
    const s = src.data, d = dst.data;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        for (let c = 0; c < 3; c++) {
          let v = 0, ki = 0;
          for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) v += s[((y + ky) * w + (x + kx)) * 4 + c] * k[ki++];
          d[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, v));
        }
        d[(y * w + x) * 4 + 3] = 255;
      }
    }
    ctx.putImageData(dst, 0, 0);
  }

  function save() {
    onSave(canvasRef.current.toDataURL("image/jpeg", 0.92));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(5,8,14,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={onClose}>
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, width: 720, maxWidth: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
          <b style={{ fontSize: 14 }}>Zoom / Enhance — {DOMAIN_LABELS[domain]} — {item.address}</b>
          <button onClick={onClose} style={{ background: "none", border: "none", color: MUTE, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        <canvas
          ref={canvasRef} width={680} height={420}
          style={{ width: "100%", borderRadius: 8, cursor: "grab", background: "#000" }}
          onMouseDown={(e) => { dragRef.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; }}
          onMouseMove={(e) => { if (dragRef.current) setOffset({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y }); }}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; }}
          onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.max(0.5, Math.min(8, z + (e.deltaY < 0 ? 0.15 : -0.15)))); }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 20px", marginTop: 12, fontSize: 12, color: MUTE }}>
          <Slider label={`Zoom calibration ×${zoom.toFixed(2)}`} min={0.5} max={8} step={0.05} value={zoom} onChange={setZoom} />
          <Slider label={`Brightness ${brightness}%`} min={40} max={200} value={brightness} onChange={setBrightness} />
          <Slider label={`Contrast ${contrast}%`} min={40} max={200} value={contrast} onChange={setContrast} />
          <Slider label={`Saturation ${saturation}%`} min={0} max={200} value={saturation} onChange={setSaturation} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <label style={{ fontSize: 12, color: MUTE, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={sharpen} onChange={(e) => setSharpen(e.target.checked)} /> Sharpen (edge enhance)
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); setBrightness(100); setContrast(100); setSaturation(100); setSharpen(false); }} style={btnSecondary}>Reset</button>
            <button onClick={save} style={btnPrimary}>Save enhanced image</button>
          </div>
        </div>
        <p style={{ fontSize: 11, color: MUTE, marginTop: 8, marginBottom: 0 }}>Drag to pan, scroll to zoom. Saving replaces this domain's image for this lead and re-queues it so the next pipeline run scores the enhanced version.</p>
      </div>
    </div>
  );
}

function Slider({ label, min, max, step = 1, value, onChange }) {
  return (
    <label style={{ display: "block" }}>
      {label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%" }} />
    </label>
  );
}

const panel = { background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 };
const panelTitle = { fontSize: 12, color: MUTE, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 };
const btnPrimary = { padding: "8px 16px", background: AMBER, color: "#1a1200", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 13 };
const btnSecondary = { padding: "8px 14px", background: "transparent", border: `1px solid ${LINE}`, borderRadius: 6, color: TEXT, cursor: "pointer", fontSize: 13 };
