"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DAMAGE_CLASSES, VERDICTS, emptyLabelDoc, toYoloLines } from "../../lib/labels";

const OVERVIEW_ANGLE_ORDER = ["overview_tight", "overview_context", "overview_hybrid_labeled"];
const ANGLE_LABELS = {
  overview_tight: "Overhead — tight",
  overview_context: "Overhead — context",
  overview_hybrid_labeled: "Overhead — wider",
};
const PROVIDER_LABELS = {
  nearmap: "Nearmap (premium)",
  google: "Google Street View",
  mapbox: "Mapbox satellite",
  "esri-free": "Esri World Imagery",
  esri_world_imagery: "Esri World Imagery",
  stored: "Stored private image",
  eagleview: "EagleView",
  unavailable: "No shot",
};

function shotLabel(key) {
  if (ANGLE_LABELS[key]) return ANGLE_LABELS[key];
  const m = key.match(/^vantage(\d+)_(.+)$/);
  if (m) return `Street ${m[1]} — ${m[2].replace(/_/g, " ")}`;
  return key.replace(/_/g, " ");
}

export default function PropertyIntelligence({ property, onClose }) {
  const [imagery, setImagery] = useState(null);
  const [imageryLoading, setImageryLoading] = useState(false);
  const [imageryError, setImageryError] = useState(null);
  const [activeShot, setActiveShot] = useState(null);
  const [classId, setClassId] = useState("shingle_loss");
  const [doc, setDoc] = useState(() => emptyLabelDoc(property, null));
  const [drag, setDrag] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(null);
  const [mode, setMode] = useState("box");
  const [saveState, setSaveState] = useState(null);
  const [imageReady, setImageReady] = useState(false);
  const requestIdRef = useRef(0);
  const imgRef = useRef(null);
  const stageRef = useRef(null);

  const seedStored = useCallback(() => {
    if (!property.imagery?.url) return false;
    const url = property.imagery.url;
    if (typeof url === "string" && /[?&](key|access_token|apikey)=/i.test(url)) return false;
    setImagery({
      shots: {
        stored_overview: {
          url,
          source: property.imagery.source || "stored",
        },
      },
      providerNote: property.imagery.attribution || "Existing private image — paid Street View not requested",
    });
    setActiveShot("stored_overview");
    return true;
  }, [property.imagery]);

  const fetchImagery = useCallback(async (paid) => {
    if (!paid) {
      if (seedStored()) return;
      if (property.lat == null || property.lon == null) {
        setImageryError("No coordinates on record for this property.");
        return;
      }
    }
    if (property.lat == null || property.lon == null) {
      setImageryError("No coordinates on record for this property.");
      return;
    }
    const requestId = ++requestIdRef.current;
    setImageryLoading(true);
    setImageryError(null);
    try {
      const res = await fetch("/api/imagery-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          lat: property.lat,
          lon: property.lon,
          leadId: property.id,
          propertyId: property.id,
          lite: paid ? false : true,
          paid: paid ? true : false,
        }),
      });
      const data = await res.json();
      if (requestId !== requestIdRef.current) return;
      if (!res.ok || data.error) {
        setImageryError(data.error || "Imagery agent failed.");
        return;
      }
      const shots = Object.fromEntries(
        Object.entries(data.angles || {})
          .filter(([, url]) => typeof url === "string" && url.startsWith("data:image/") && !/[?&](key|access_token|apikey)=/i.test(url))
          .map(([key, url]) => [key, {
            url,
            source: data.provider || "unavailable",
            resolution: data.resolution?.[key] || null,
            bearingToProperty: (data.sweep || []).find((item) => item.key === key)?.bearingToProperty ?? null,
          }])
      );
      if (!Object.keys(shots).length) {
        setImageryError("Imagery provider returned no usable shots.");
        return;
      }
      setImagery((prev) => ({
        shots: { ...(prev?.shots || {}), ...shots },
        providerNote: Array.isArray(data.notes) ? data.notes.join(" ") : data.provider || null,
        capturedDate: data.capturedDate || null,
        paid: Boolean(data.paid),
      }));
      const firstKey =
        OVERVIEW_ANGLE_ORDER.find((key) => shots[key]?.url) ||
        Object.keys(shots).find((key) => shots[key]?.url);
      setActiveShot(firstKey || null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setImageryError(err?.message || "Network error.");
    } finally {
      if (requestId === requestIdRef.current) setImageryLoading(false);
    }
  }, [property.id, property.lat, property.lon, seedStored]);

  useEffect(() => {
    fetchImagery(false);
  }, [fetchImagery]);

  const shotKeys = useMemo(() => {
    const shots = imagery?.shots || {};
    const rest = Object.keys(shots).filter((k) => !OVERVIEW_ANGLE_ORDER.includes(k));
    return [...OVERVIEW_ANGLE_ORDER.filter((k) => shots[k]), ...rest];
  }, [imagery]);

  const active = imagery?.shots?.[activeShot];

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setImageReady(false);
    setSaveState(null);
    if (!activeShot) {
      setDoc(emptyLabelDoc(property, null));
      return;
    }
    let cancelled = false;
    const empty = { ...emptyLabelDoc(property, activeShot), source: active?.source || null };
    setDoc(empty);
    fetch(
      `/api/property-labels?propertyId=${encodeURIComponent(property.id)}&shotKey=${encodeURIComponent(activeShot)}`,
      { cache: "no-store" }
    )
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data.ok && data.doc) setDoc(data.doc);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeShot, active?.source, property]);

  function clientToImage(e) {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * img.naturalWidth;
    const y = ((e.clientY - r.top) / r.height) * img.naturalHeight;
    return { x, y, w: img.naturalWidth, h: img.naturalHeight };
  }

  function onPointerDown(e) {
    if (mode === "pan") {
      setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }
    const p = clientToImage(e);
    if (!p) return;
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function onPointerMove(e) {
    if (panning) {
      setPan({ x: e.clientX - panning.x, y: e.clientY - panning.y });
      return;
    }
    if (!drag) return;
    const p = clientToImage(e);
    if (!p) return;
    setDrag({ ...drag, x1: p.x, y1: p.y });
  }

  function onPointerUp() {
    if (panning) {
      setPanning(null);
      return;
    }
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (w < 8 || h < 8) return;
    setDoc((d) => ({
      ...d,
      boxes: [...d.boxes, { id: crypto.randomUUID(), classId, x, y, w, h }],
    }));
  }

  function wheel(e) {
    e.preventDefault();
    const next = Math.min(6, Math.max(1, zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
    setZoom(next);
  }

  async function save() {
    if (!activeShot) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/property-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      const data = await res.json();
      setSaveState(data.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  function downloadLabels() {
    const img = imgRef.current;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            ...doc,
            yolo: img ? toYoloLines(doc, img.naturalWidth, img.naturalHeight) : "",
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${property.id}-${activeShot || "shot"}-labels.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const storm = property.stormExposure || {};

  return (
    <div className="intel-overlay" role="dialog" aria-modal="true">
      <div className="intel-panel">
        <header className="intel-head">
          <div>
            <div className="eyebrow">PROPERTY INTELLIGENCE</div>
            <h2>{property.address}</h2>
            <p>
              {property.city}, {property.state} {property.zip} · score {property.score ?? "—"} · built{" "}
              {property.yearBuilt ?? "?"}
              {storm.hailInches ? ` · ${storm.hailInches}" hail` : ""}
              {storm.windMph ? ` · ${storm.windMph} mph` : ""}
            </p>
          </div>
          <button className="ghost" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="intel-body">
          <div className="inspect-stage" ref={stageRef} onWheel={wheel}>
            {imageryLoading && <div className="stage-msg">Loading shots…</div>}
            {imageryError && <div className="stage-msg error">{imageryError}</div>}
            {!imageryLoading && !active?.url && !imageryError && (
              <div className="stage-msg">No imagery for this angle.</div>
            )}
            {active?.url && (
              <div
                className="stage-world"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                <Image
                  ref={imgRef}
                  src={active.url}
                  alt={shotLabel(activeShot)}
                  width={640}
                  height={640}
                  sizes="(max-width: 800px) 100vw, 760px"
                  unoptimized
                  draggable={false}
                  onLoad={() => setImageReady(true)}
                />
                {imageReady && (
                  <Boxes
                    boxes={doc.boxes}
                    live={drag}
                    img={imgRef.current}
                    onRemove={(id) => setDoc((d) => ({ ...d, boxes: d.boxes.filter((b) => b.id !== id) }))}
                  />
                )}
              </div>
            )}
          </div>

          <aside className="intel-side">
            <div className="side-block">
              <h3>Shots</h3>
              <div className="shot-strip">
                {shotKeys.map((key) => {
                  const s = imagery.shots[key];
                  return (
                    <button
                      key={key}
                      className={`shot-thumb ${key === activeShot ? "active" : ""} ${s.url ? "" : "dead"}`}
                      onClick={() => s.url && setActiveShot(key)}
                    >
                      {s.url ? (
                        <Image src={s.url} alt="" width={64} height={48} sizes="64px" unoptimized />
                      ) : <span>—</span>}
                      <em>{shotLabel(key)}</em>
                      <small>{PROVIDER_LABELS[s.source] || s.source}</small>
                    </button>
                  );
                })}
              </div>
              {imagery?.providerNote && <p className="hint">{imagery.providerNote}</p>}
              <div className="row">
                <button
                  className="primary"
                  onClick={() => fetchImagery(true)}
                  disabled={imageryLoading || property.lat == null || property.lon == null}
                >
                  {imageryLoading ? "Loading shots…" : "Load paid Street View"}
                </button>
              </div>
              <p className="hint">
                Free path is the stored private image or Esri World Imagery. Street View is fetched server-side only after this button, with heading equal to the bearing from each panorama to the parcel.
              </p>
            </div>

            <div className="side-block">
              <h3>Inspect</h3>
              <div className="row">
                <button className={mode === "box" ? "on" : ""} onClick={() => setMode("box")}>
                  Draw box
                </button>
                <button className={mode === "pan" ? "on" : ""} onClick={() => setMode("pan")}>
                  Pan
                </button>
                <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset view</button>
              </div>
              <label>
                Class
                <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                  {DAMAGE_CLASSES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="box-list">
                {doc.boxes.map((b) => {
                  const meta = DAMAGE_CLASSES.find((c) => c.id === b.classId);
                  return (
                    <li key={b.id}>
                      <i style={{ background: meta?.color }} />
                      {meta?.label}
                      <button onClick={() => setDoc((d) => ({ ...d, boxes: d.boxes.filter((x) => x.id !== b.id) }))}>
                        ×
                      </button>
                    </li>
                  );
                })}
                {doc.boxes.length === 0 && <li className="muted">No boxes yet. Drag on the image.</li>}
              </ul>
            </div>

            <div className="side-block">
              <h3>Verdict</h3>
              <div className="row wrap">
                {VERDICTS.map((v) => (
                  <button
                    key={v.id}
                    className={doc.verdict === v.id ? "on" : ""}
                    onClick={() => setDoc((d) => ({ ...d, verdict: v.id }))}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              <textarea
                rows={3}
                placeholder="Notes for training / sales"
                value={doc.notes}
                onChange={(e) => setDoc((d) => ({ ...d, notes: e.target.value }))}
              />
              <div className="row">
                <button className="primary" onClick={save} disabled={!activeShot || saveState === "saving"}>
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save labels"}
                </button>
                <button onClick={downloadLabels}>Export JSON</button>
              </div>
              <p className="hint">
                Hail bruises need close-up / drone. If you cannot see the defect at this zoom, verdict is Needs
                drone — do not invent a box.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Boxes({ boxes, live, img, onRemove }) {
  if (!img?.naturalWidth) return null;
  const sx = img.clientWidth / img.naturalWidth;
  const sy = img.clientHeight / img.naturalHeight;
  const rects = [...boxes];
  if (live) {
    rects.push({
      id: "live",
      classId: null,
      x: Math.min(live.x0, live.x1),
      y: Math.min(live.y0, live.y1),
      w: Math.abs(live.x1 - live.x0),
      h: Math.abs(live.y1 - live.y0),
      live: true,
    });
  }
  return (
    <div className="box-layer">
      {rects.map((b) => {
        const meta = DAMAGE_CLASSES.find((c) => c.id === b.classId);
        return (
          <div
            key={b.id}
            className={`box ${b.live ? "live" : ""}`}
            style={{
              left: b.x * sx,
              top: b.y * sy,
              width: b.w * sx,
              height: b.h * sy,
              borderColor: meta?.color || "#fff",
            }}
            onDoubleClick={() => !b.live && onRemove(b.id)}
          />
        );
      })}
    </div>
  );
}
