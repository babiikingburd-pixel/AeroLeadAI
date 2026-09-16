// Intentionally not a filesystem store. Vercel local disk is not durable.
// Labels persist through /api/property-labels -> oversight_property_labels.

export function labelPath() {
  throw new Error("data/apex filesystem labels are disabled. Use /api/property-labels.");
}

export function cachePath() {
  throw new Error("data/apex filesystem cache is disabled. Use the production imagery agent.");
}

export async function readJson() {
  throw new Error("data/apex filesystem persistence is disabled.");
}

export async function writeJson() {
  throw new Error("data/apex filesystem persistence is disabled.");
}
