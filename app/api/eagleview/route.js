import {
  eagleViewConfig,
  eagleViewConfigured,
  eagleViewFetch,
  extractPropertyImages,
  fetchPropertyImage,
  findRequestId,
  getPropertyResult,
  requestPropertyData,
} from "../../../lib/eagleview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_PRODUCTS = [
  "property_data_id_001", // Roof Area Estimate
  "property_data_id_002", // Roof Pitch and Eave Height
  "property_data_id_003", // Roof Material & Condition
  "property_data_id_004", // Roof Age
  "property_data_id_005", // Property Condition & Details
  "property_data_id_006", // Risk & Vulnerability Scores
  "property_data_id_007", // Building Outlines
  "property_data_id_008", // Property Ortho Imagery
  "property_data_id_009", // Property Oblique Imagery
];

function safeConfig() {
  const cfg = eagleViewConfig();
  return {
    configured: eagleViewConfigured(),
    environment: cfg.environment,
    baseUrl: cfg.baseUrl,
    authMode: cfg.accessToken ? "bearer" : cfg.apiKey ? "api-key" : (cfg.clientId && cfg.clientSecret) ? "client-credentials" : "none",
  };
}

async function waitForResult(requestId, maxWaitMs = 25_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < maxWaitMs) {
    last = await getPropertyResult(requestId);
    const status = String(last?.data?.request?.status || last?.data?.status || "").toLowerCase();
    if (last.status === 200 && status !== "in progress" && status !== "processing") return last.data;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return last?.data || null;
}

export async function GET(req) {
  const url = new URL(req.url);
  const requestId = url.searchParams.get("requestId");
  const imageToken = url.searchParams.get("imageToken");

  try {
    if (imageToken) {
      const upstream = await fetchPropertyImage(imageToken);
      const bytes = await upstream.arrayBuffer();
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "image/png",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    if (requestId) {
      const result = await getPropertyResult(requestId);
      const images = result.status === 200 ? extractPropertyImages(result.data) : [];
      return Response.json({ ok: true, requestId, upstreamStatus: result.status, images, data: result.data });
    }

    return Response.json({
      ok: true,
      service: "eagleview",
      ...safeConfig(),
      capabilities: ["property-data-v2", "roof-condition", "roof-age", "risk", "building-outlines", "ortho-imagery", "oblique-imagery"],
    });
  } catch (e) {
    return Response.json({ ok: false, ...safeConfig(), error: e?.message || "EagleView request failed" }, { status: 502 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const productIds = Array.isArray(body.productIds) && body.productIds.length ? body.productIds : DEFAULT_PRODUCTS;
    const submitted = await requestPropertyData({
      address: body.address,
      lat: body.lat,
      lon: body.lon,
      productIds,
    });
    const requestId = findRequestId(submitted);

    if (!requestId || body.wait === false) {
      return Response.json({ ok: true, submitted, requestId, productIds, ...safeConfig() });
    }

    const data = await waitForResult(requestId, Math.min(Number(body.maxWaitMs || 25_000), 50_000));
    const images = extractPropertyImages(data);
    return Response.json({
      ok: true,
      requestId,
      productIds,
      images: images.map((img) => ({
        ...img,
        proxyUrl: `/api/eagleview?imageToken=${encodeURIComponent(img.token)}`,
      })),
      data,
      ...safeConfig(),
    });
  } catch (e) {
    return Response.json({ ok: false, ...safeConfig(), error: e?.message || "EagleView request failed" }, { status: 502 });
  }
}
