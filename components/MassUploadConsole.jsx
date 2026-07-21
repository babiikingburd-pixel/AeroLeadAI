"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// ---- palette matched to PropertyIntelligenceConsole ----
const SLATE = "#0d1420", PANEL = "#131c2b", PANEL2 = "#0f1725", LINE = "#22304a";
const AMBER = "#f5b942", BLUE = "#4fa3e3", GREEN = "#4fc98e", SIGNAL = "#ef5a6f", MUTE = "#77839a";
const TEXT = "#dfe6ee";

const uid = () => Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();
const STORE_KEY = "aerolead:batch:v1";

const TEN_YEARS_MS = 10 * 365.25 * 24 * 3600 * 1000;

function tierOf(item) {
  // Business rule (stated): any property with a permit pulled in the last ten
  // years is low priority — this overrides the damage score entirely.
  if (item.permitWithin10y) return "low-priority";
  const s = item.damageScore;
  if (s === null || s === undefined) return "unscored";
  if (s >= 75) return "hot";
  if (s >= 50) return "warm";
  if (s >= 25) return "cool";
  return "cold";
}

const TIER_COLORS = { hot: SIGNAL, warm: AMBER, cool: BLUE, cold: MUTE, "low-priority": "#8a6bd1", unscored: MUTE };

export default function MassUploadConsole() {
  const [items, setItems] = useState({});
  const [order, setOrder] = useState([]);
  const [addressText, setAddressText] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [editorId, setEditorId] = useState(null);
  const fileRef = useRef(null);

  // ---- persistence ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setItems(saved.items || {});
        setOrder(saved.order || []);
      }
    } catch {}
  }, []);

  // Safe write: if images push us over the ~5MB quota, retry storing metadata
  // only (drop dataUrls) so scores/addresses always persist even for big batches.
  function safeStore(nextItems, nextOrder) {
    const payload = { items: nextItems, order: nextOrder };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch {
      try {
        const stripped = {};
        for (const k in nextItems) stripped[k] = { ...nextItems[k], dataUrl: null };
        localStorage.setItem(STORE_KEY, JSON.stringify({ items: stripped, order: nextOrder }));
      } catch {}
    }
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
        upsert({
          id: uid(), address: cols[0],
          lat: Number.isFinite(maybeLat) ? cols[1] : null,
          lon: Number.isFinite(maybeLon) ? cols[2] : null,
          dataUrl: null, damageScore: null, damageNotes: null,
          permitWithin10y: false, permitNotes: "Not checked", stage: "queued", log: ["Imported from CSV"],
        });
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
      props[id] = {
        id, address: it.address, lat: it.lat || "", lon: it.lon || "",
        parcelId: "", permitId: "", roofType: "", buildingAge: "", roofPitch: "",
        createdAt: nowIso(),
        folders: {
          images: it.dataUrl ? [{ id: uid(), domain: "roof", dataUrl: it.dataUrl, mediaType: "image/jpeg", uploadedAt: nowIso() }] : [],
          drone: [], street: [], historical: [], weather: [],
          permits: it.permitNotes && it.permitNotes !== "Not checked" ? [{ id: uid(), text: `[From batch] ${it.permitNotes}`, at: nowIso() }] : [],
          inspectionReports: [], contractorNotes: [],
          aiFindings: it.damageScore !== null ? [{ id: uid(), at: nowIso(), results: [{ domain: "roof", concern_score: it.damageScore, notes: it.damageNotes }], findingsScore: it.damageScore }] : [],
          repairs: [], timeline: [{ id: uid(), at: nowIso(), text: "Promoted from batch pipeline" }],
        },
        findingsScore: it.damageScore, suggestedActions: [],
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
        upsert({
          id: uid(), address: a.address,
          lat: a.lat || null, lon: a.lon || null,
          dataUrl: null, damageScore: null, damageNotes: null,
          permitWithin10y: false, permitNotes: "Not checked",
          stage: "queued", log: [`Imported from ZIP ${data.zip} scan`],
        });
      });
      setZipResult({ count: data.count, city: data.city, state: data.state });
    } catch (e) {
      setZipResult({ error: e.message });
    }
    setZipScanning(false);
  }

  function queueAddresses() {
    const lines = addressText.split("\n").map((l) => l.trim()).filter(Boolean);
    lines.forEach((address) => {
      upsert({ id: uid(), address, lat: null, lon: null, dataUrl: null, damageScore: null, damageNotes: null, permitWithin10y: false, permitNotes: "Not checked", stage: "queued", log: [] });
    });
    setAddressText("");
  }

  // ---- intake: drop/select images (address optional, editable inline) ----
  function handleFiles(fileList) {
    Array.from(fileList).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = () => {
        upsert({ id: uid(), address: file.name.replace(/\.[a-z]+$/i, ""), lat: null, lon: null, dataUrl: reader.result, damageScore: null, damageNotes: null, permitWithin10y: false, permitNotes: "Not checked", stage: "queued", log: [] });
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

  async function fetchImagery(item) {
    if (item.dataUrl || !item.lat || !item.lon) return item;
    try {
      const res = await fetch("/api/imagery-agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lat: item.lat, lon: item.lon }) });
      const data = await res.json();
      if (data.dataUrl) {
        // Keep every roofline-angle shot alongside the primary tile — batch
        // triage now sees the same angles the deep-dive console does, just
        // without the 3x averaging/verification pass (cost control at volume).
        const extraAngles = data.angles
          ? Object.entries(data.angles).filter(([k]) => k.includes("roofline") || k === "overview_tight").map(([, v]) => v)
          : [];
        return { ...item, dataUrl: data.dataUrl, extraImages: extraAngles, log: [...item.log, `Imagery auto-fetched (${data.provider}) — ${1 + extraAngles.length} angle(s)`] };
      }
      return { ...item, log: [...item.log, data.notes || data.error || "Imagery unavailable"] };
    } catch { return { ...item, log: [...item.log, "Imagery fetch failed"] }; }
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

  async function runDamage(item) {
    if (!item.dataUrl) return { ...item, damageNotes: "No image — manual review", log: [...item.log, "Skipped vision (no image)"] };
    if (item.permitWithin10y) return { ...item, damageNotes: "Skipped — low priority by permit rule", log: [...item.log, "Skipped vision (10-year permit rule)"] };
    try {
      const primary = toImagePayload(item.dataUrl);
      if (!primary) return { ...item, damageNotes: "Unreadable image data", log: [...item.log, "Bad image data"] };
      const extras = (item.extraImages || []).map(toImagePayload).filter(Boolean);
      const images = [primary, ...extras];
      const res = await fetch("/api/damage-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: "roof", images, address: item.address }),
      });
      const data = await res.json();
      if (data.error) return { ...item, damageNotes: data.error, log: [...item.log, "Vision error: " + data.error] };
      return { ...item, damageScore: data.concern_score, damageNotes: `${data.notes || ""} [${data.provider}, ${images.length} angle(s)]`, log: [...item.log, `Damage scored ${data.concern_score} (${data.confidence}) across ${images.length} angle(s)`] };
    } catch (e) { return { ...item, damageNotes: "Vision call failed", log: [...item.log, "Vision call failed: " + e.message] }; }
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
      if (it && it.stage === "done" && (it.damageScore === null && !it.permitWithin10y)) {
        upsert({ ...it, stage: "queued", log: [...it.log, "Re-queued for retry"] });
      }
    });
  }

  function removeItem(id) {
    const next = { ...items }; delete next[id];
    persist(next, order.filter((o) => o !== id));
  }

  function exportCsv() {
    const header = ["tier", "address", "lat", "lon", "damage_score", "permit_within_10y", "permit_notes", "damage_notes"];
    const rows = order.map((id) => items[id]).filter(Boolean).map((it) => [tierOf(it), it.address, it.lat || "", it.lon || "", it.damageScore ?? "", it.permitWithin10y, it.permitNotes, it.damageNotes || ""]);
    const csv = [header.join(",")].concat(rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "aeroleadai_batch.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  // ---- sorted view: hot first, low-priority last ----
  const tierRank = { hot: 0, warm: 1, cool: 2, cold: 3, unscored: 4, "low-priority": 5 };
  const sorted = order.map((id) => items[id]).filter(Boolean).sort((a, b) => tierRank[tierOf(a)] - tierRank[tierOf(b)]);

  return (
    <div style={{ minHeight: "100vh", background: SLATE, color: TEXT, fontFamily: "Inter, system-ui, sans-serif", padding: "28px 36px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: `1px solid ${LINE}`, paddingBottom: 14, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace" }}>AEROLEADAI</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>Mass Upload — Autonomous Batch Pipeline</h1>
          <p style={{ color: MUTE, fontSize: 13, margin: "6px 0 0", maxWidth: 640 }}>
            Paste addresses or drop images. One click runs everything: geocode → satellite imagery → permit directory check (10-year rule) → damage vision → ranked output.
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

      {!sorted.length && <div style={{ color: MUTE, textAlign: "center", padding: 40 }}>Nothing queued yet.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
        {sorted.map((it) => {
          const tier = tierOf(it);
          return (
            <div key={it.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ position: "relative", height: 150, background: PANEL2 }}>
                {it.dataUrl
                  ? <img src={it.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: MUTE, fontSize: 12 }}>{it.stage === "done" ? "No imagery — manual review" : "Awaiting imagery"}</div>}
                <span style={{ position: "absolute", top: 8, left: 8, padding: "3px 9px", borderRadius: 20, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", background: "rgba(13,20,32,.85)", color: TIER_COLORS[tier] }}>{tier}</span>
                <button onClick={() => removeItem(it.id)} style={{ position: "absolute", top: 6, right: 6, background: "rgba(13,20,32,.8)", border: "none", color: TEXT, width: 22, height: 22, borderRadius: "50%", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
                {it.dataUrl && (
                  <button onClick={() => setEditorId(it.id)} style={{ position: "absolute", bottom: 6, right: 6, padding: "4px 10px", background: "rgba(13,20,32,.85)", border: `1px solid ${LINE}`, borderRadius: 6, color: BLUE, fontSize: 11, cursor: "pointer" }}>
                    Zoom / Enhance
                  </button>
                )}
              </div>
              <div style={{ padding: "10px 12px" }}>
                <input
                  value={it.address}
                  onChange={(e) => upsert({ ...it, address: e.target.value })}
                  style={{ width: "100%", background: "transparent", border: "none", borderBottom: `1px solid ${LINE}`, color: TEXT, fontSize: 13, fontWeight: 600, padding: "2px 0", marginBottom: 6, boxSizing: "border-box" }}
                />
                <div style={{ fontSize: 11.5, color: MUTE, lineHeight: 1.5 }}>
                  <div>Damage: <b style={{ color: TEXT }}>{it.damageScore ?? "—"}</b>{it.damageNotes ? <span title={it.damageNotes}> ⓘ</span> : null}</div>
                  <div title={it.permitNotes}>Permit: {it.permitWithin10y ? <b style={{ color: "#8a6bd1" }}>within 10y → low priority</b> : it.permitNotes}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 10.5 }}>{it.lat && it.lon ? `${Number(it.lat).toFixed(4)}, ${Number(it.lon).toFixed(4)}` : "no coords"} · {it.stage}</div>
                </div>
                {it.stage === "done" && !it.permitWithin10y && (
                  <button onClick={() => promoteToDeepDive(it)} style={{ ...btnSecondary, width: "100%", marginTop: 8, padding: "6px 0", fontSize: 12, color: GREEN, borderColor: GREEN }}>
                    Promote to deep-dive →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {editorId && items[editorId] && (
        <ImageEditor
          item={items[editorId]}
          onClose={() => setEditorId(null)}
          onSave={(newDataUrl) => { upsert({ ...items[editorId], dataUrl: newDataUrl, damageScore: null, damageNotes: "Image edited — re-run pipeline to rescore", stage: "queued", log: [...items[editorId].log, "Image enhanced/edited"] }); setEditorId(null); }}
        />
      )}
    </div>
  );
}

function StatsStrip({ items, order }) {
  const all = order.map((id) => items[id]).filter(Boolean);
  const counts = { hot: 0, warm: 0, cool: 0, cold: 0, "low-priority": 0, unscored: 0 };
  all.forEach((it) => { counts[tierOf(it)]++; });
  const doneCount = all.filter((it) => it.stage === "done").length;
  const scored = all.filter((it) => it.damageScore !== null && it.damageScore !== undefined);
  const avg = scored.length ? Math.round(scored.reduce((s, it) => s + it.damageScore, 0) / scored.length) : "—";
  const cells = [
    ["Hot", counts.hot, SIGNAL], ["Warm", counts.warm, AMBER], ["Cool", counts.cool, BLUE], ["Cold", counts.cold, MUTE],
    ["Low priority (10y rule)", counts["low-priority"], "#8a6bd1"], ["Avg damage", avg, TEXT], ["Processed", `${doneCount}/${all.length}`, TEXT],
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
function ImageEditor({ item, onClose, onSave }) {
  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [sharpen, setSharpen] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => { imgRef.current = img; draw(); };
    img.src = item.dataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.dataUrl]);

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
          <b style={{ fontSize: 14 }}>Zoom / Enhance — {item.address}</b>
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
        <p style={{ fontSize: 11, color: MUTE, marginTop: 8, marginBottom: 0 }}>Drag to pan, scroll to zoom. Saving replaces the image for this lead and re-queues it so the next pipeline run scores the enhanced version.</p>
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
