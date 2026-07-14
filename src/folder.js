/**
 * OnlyWorlds Folder Format writer (spec skeleton v0.2 conformance, Writer class):
 * - elements/<type>/<slug>--<uuid-tail>.json (filename presentation-only)
 * - identity in the file's `id` field; id persisted at mint, never re-derived
 * - bare link names on disk
 * - world.json at the root (minimal: name; format is one-world-per-folder)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function slugify(name, max = 60) {
  const s = String(name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s;
}

export function filenameFor(type, element) {
  const tail = element.id.replaceAll("-", "").slice(-8);
  const slug = slugify(element.name || "");
  return slug ? `${slug}--${tail}.json` : `${type}--${tail}.json`;
}

/** Write { type, element } pairs as a world folder. Returns written paths. */
export function writeWorldFolder(dir, worldName, items) {
  const written = [];
  mkdirSync(dir, { recursive: true });
  const worldPath = join(dir, "world.json");
  writeFileSync(worldPath, JSON.stringify({ name: worldName }, null, 2) + "\n");
  written.push(worldPath);
  for (const { type, element } of items) {
    const typeDir = join(dir, "elements", type);
    mkdirSync(typeDir, { recursive: true });
    const p = join(typeDir, filenameFor(type, element));
    writeFileSync(p, JSON.stringify(element, null, 2) + "\n");
    written.push(p);
  }
  return written;
}
