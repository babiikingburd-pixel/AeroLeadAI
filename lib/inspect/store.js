import { promises as fs } from "fs";
import path from "path";

const ROOT = path.join(process.cwd(), "data", "apex");

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function readJson(rel, fallback = null) {
  const file = path.join(ROOT, rel);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeJson(rel, value) {
  const file = path.join(ROOT, rel);
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
  return value;
}

export function labelPath(propertyId) {
  return path.join("labels", `${safeId(propertyId)}.json`);
}

export function cachePath(name) {
  return path.join("cache", `${safeId(name)}.json`);
}
