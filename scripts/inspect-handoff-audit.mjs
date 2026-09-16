#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const {
  isPaidRequest,
  providerPlan,
  cacheUsableForRequest,
  publicImageryPayload,
  isPaidProvider,
} = await import("../lib/imagery/paidGate.js");
const { clampPropertyLimit, summarizeRankCounts, PROPERTY_PAGE_MAX } = await import("../lib/apex/propertyLimit.js");
const { labelIdentifiers, normalizeLabelDocument } = await import("../lib/labels.js");

assert.equal(isPaidRequest(true), true);
assert.equal(isPaidRequest(1), true);
assert.equal(isPaidRequest("1"), true);
assert.equal(isPaidRequest("true"), true);
assert.equal(isPaidRequest(false), false);
assert.equal(isPaidRequest(0), false);
assert.equal(isPaidRequest("0"), false);
assert.equal(isPaidRequest(undefined), false);

const keys = { nearmap: "nm", google: "g", mapbox: "mb" };
assert.deepEqual(providerPlan({ paid: false, keys }).map((step) => step.id), ["esri-free"]);
assert.deepEqual(providerPlan({ paid: true, keys }).map((step) => step.id), ["nearmap", "google", "mapbox", "esri-free"]);
assert.deepEqual(providerPlan({ paid: true, keys: {} }).map((step) => step.id), ["esri-free"]);
assert.equal(isPaidProvider("google"), true);
assert.equal(isPaidProvider("esri-free"), false);
assert.equal(cacheUsableForRequest({ provider: "google", angles: { overview_tight: "x" } }, { paid: false, lite: true }), false);
assert.equal(cacheUsableForRequest({ provider: "esri-free", angles: { overview_tight: "x" } }, { paid: false, lite: true }), true);
assert.equal(cacheUsableForRequest({ provider: "esri-free", angles: { overview_tight: "x" } }, { paid: true, lite: false }), false);
assert.equal(cacheUsableForRequest({ provider: "google", storage_paths: { vantage1_facing_level: "p" } }, { paid: true, lite: false }), true);

const stripped = publicImageryPayload({
  angles: {
    overview_tight: "data:image/jpeg;base64,abc",
    leak: "https://maps.googleapis.com/maps/api/staticmap?key=SECRET",
  },
  notes: ["ok"],
  paid: false,
});
assert.equal(stripped.angles.overview_tight.startsWith("data:image/"), true);
assert.equal(stripped.angles.leak, undefined);

assert.equal(clampPropertyLimit(undefined), 100);
assert.equal(clampPropertyLimit(100), 100);
assert.equal(clampPropertyLimit(500), 500);
assert.equal(clampPropertyLimit(501), PROPERTY_PAGE_MAX);
assert.equal(clampPropertyLimit("500"), 500);
assert.deepEqual(summarizeRankCounts([{ live_rank: 1 }, { live_rank: 100 }, { live_rank: 101 }, { live_rank: 500 }]), {
  top100Count: 2,
  top500Count: 4,
});

const ids = labelIdentifiers({ propertyId: "dakota-123", shotKey: "stored_overview" });
assert.equal(ids.propertyId, "dakota-123");
assert.equal(ids.shotKey, "stored_overview");
assert.equal(labelIdentifiers({ propertyId: "dakota-123" }).error.includes("shotKey"), true);

const labeled = normalizeLabelDocument({
  propertyId: "dakota-123",
  shotKey: "stored_overview",
  address: "4300 Interlachen Blvd",
  source: "stored",
  classId: "shingle_loss",
  boxes: [{ id: "box-1", classId: "shingle_loss", x: 10, y: 10, w: 40, h: 40 }],
  verdict: "needs_drone",
  notes: "cannot confirm hail bruise at this zoom",
}, { now: () => "2026-09-16T00:00:00.000Z" });
assert.equal(labeled.propertyId, "dakota-123");
assert.equal(labeled.shotKey, "stored_overview");
assert.equal(labeled.doc.boxes[0].classId, "shingle_loss");

const store = new Map();
function upsertLabel(doc) {
  const key = `${doc.propertyId}::${doc.shotKey}`;
  store.set(key, doc);
  return store.get(key);
}
function getLabel(propertyId, shotKey) {
  return store.get(`${propertyId}::${shotKey}`) || null;
}
upsertLabel(labeled.doc);
const otherShot = normalizeLabelDocument({
  propertyId: "dakota-123",
  shotKey: "overview_tight",
  source: "esri-free",
  boxes: [],
  notes: "esri overview, no boxes",
}, { now: () => "2026-09-16T00:00:01.000Z" });
upsertLabel(otherShot.doc);
const reloaded = getLabel("dakota-123", "stored_overview");
assert.equal(reloaded.notes, "cannot confirm hail bruise at this zoom");
assert.equal(reloaded.boxes.length, 1);
assert.equal(getLabel("dakota-123", "overview_tight").boxes.length, 0);
assert.equal(getLabel("dakota-123", "overview_tight").notes.includes("esri"), true);

const agent = read("app/api/imagery-agent/route.js");
assert.ok(agent.includes("from \"../../../lib/imagery/paidGate\""), "imagery-agent must import paidGate");
assert.ok(agent.includes("isPaidRequest(paidRaw)"), "imagery-agent must read paid from the body");
assert.ok(agent.includes("providerPlan({ paid, keys })"), "imagery-agent must use providerPlan, not unguarded key checks");
assert.ok(!/if \(nearmapKey\) attempts\.push/.test(agent), "paid providers must not run just because a key exists");
assert.ok(!/if \(googleKey\) attempts\.push/.test(agent), "Google must not run just because a key exists");
assert.ok(!/if \(mapboxKey\) attempts\.push/.test(agent), "Mapbox must not run just because a key exists");
assert.ok(agent.includes("const lite = paid ? Boolean(requestedLite) : true"), "unpaid requests must force lite");

const inspector = read("app/apex/PropertyIntelligence.js");
assert.ok(inspector.includes("Load paid Street View"), "inspector must expose the paid action");
assert.ok(inspector.includes("fetchImagery(false)"), "inspector must open on the free path");
assert.ok(inspector.includes("paid: paid ? true : false"), "inspector must send paid=true only from the button");
assert.ok(inspector.includes("lite: paid ? false : true"), "inspector must not send lite:false unless paid");
assert.ok(inspector.includes("seedStored"), "inspector must seed stored/private imagery first");
assert.ok(inspector.includes("shotKey=${encodeURIComponent(activeShot)}"), "labels must load by active shot");

const properties = read("app/api/apex/properties/route.js");
assert.ok(properties.includes("MAX_LIMIT = 500"), "Top 500 must not be clamped at 100");
assert.ok(properties.includes("top100Count"), "API must return top100Count");
assert.ok(properties.includes("top500Count"), "API must return top500Count");
assert.ok(properties.includes(".range(offset, offset + limit - 1)"), "API must page/return the requested ranked rows");

const labelsRoute = read("app/api/property-labels/route.js");
assert.ok(labelsRoute.includes("oversight_property_labels"), "labels persist in oversight_property_labels");
assert.ok(labelsRoute.includes(".eq(\"shot_key\", ids.shotKey)"), "label GET is shot-specific");
assert.ok(labelsRoute.includes("onConflict: \"property_id,shot_key\""), "label POST upserts per property and shot");

const migration = read("supabase/migrations/20260916040000_inspect_labels_service_role_only.sql");
assert.ok(migration.includes("revoke all on table public.oversight_property_labels from public, anon, authenticated"));
assert.ok(migration.includes("grant select, insert, update, delete on table public.oversight_property_labels to service_role"));
assert.ok(!/create policy[\s\S]{0,200}using\s*\(\s*true\s*\)/i.test(migration), "labels must not create public using(true) policies");

const esriUrl = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=-93.3505,44.9112,-93.3489,44.9128&bboxSR=4326&imageSR=3857&size=640,640&format=jpg&compressionQuality=70&f=image";
const esri = await fetch(esriUrl);
assert.equal(esri.ok, true, "Esri must return a live image for a real Edina coordinate");
assert.match(esri.headers.get("content-type") || "", /image\/jpeg/);
const bytes = Buffer.from(await esri.arrayBuffer());
assert.ok(bytes.length > 20_000, `Esri image too small: ${bytes.length}`);
fs.writeFileSync("/tmp/esri-edina-interlachen.jpg", bytes);

console.log(JSON.stringify({
  ok: true,
  paidGate: {
    unpaidPlan: providerPlan({ paid: false, keys }).map((step) => step.id),
    paidPlan: providerPlan({ paid: true, keys }).map((step) => step.id),
  },
  top500: { max: PROPERTY_PAGE_MAX, clamp501: clampPropertyLimit(501) },
  labels: {
    propertyId: labeled.propertyId,
    storedShotSurvivesReload: reloaded.boxes.length === 1,
    otherShotIsolated: getLabel("dakota-123", "overview_tight").boxes.length === 0,
  },
  esri: { bytes: bytes.length, contentType: esri.headers.get("content-type"), lat: 44.912, lon: -93.3497, place: "Interlachen Blvd, Edina MN" },
}, null, 2));
