/**
 * OnlyWorlds Folder Format writer (spec skeleton v0.2 conformance, Writer class):
 * - content types → elements/<type>/<slug>--<uuid-tail>.json (filename presentation-only)
 * - SPATIAL types (map/pin/zone/marker) → spatial/<type>/... — Atlas's reader
 *   only indexes spatial elements there (live-tested 2026-07-14)
 * - identity in the file's `id` field; id persisted at mint, never re-derived
 * - bare link names on disk
 * - world.json at the root MUST carry `id` + `name` — Atlas world discovery
 *   rejects a folder whose world.json lacks either (live-tested 2026-07-14)
 */

import { mkdirSync, writeFileSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { uuidv7 } from "./ids.js";

const SPATIAL_TYPES = new Set(["map", "pin", "zone", "marker"]);

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

/**
 * Write { type, element } pairs as a world folder. Returns written paths.
 * Folder bodies carry three fields the API dialect does NOT (live-tested
 * against Atlas 2026-07-14 — without `type` in the body, the app shows an
 * empty world): `type`, `local_updated_at`, `created_at`. They are stamped
 * here, on the folder write path only — never into bulk/API payloads.
 */
export function writeWorldFolder(dir, worldName, items, stamp = new Date().toISOString()) {
  const written = [];
  mkdirSync(dir, { recursive: true });
  const worldPath = join(dir, "world.json");
  writeFileSync(worldPath, JSON.stringify({ id: uuidv7(), name: worldName }, null, 2) + "\n");
  written.push(worldPath);
  for (const { type, element } of items) {
    const typeDir = join(dir, SPATIAL_TYPES.has(type) ? "spatial" : "elements", type);
    mkdirSync(typeDir, { recursive: true });
    const p = join(typeDir, filenameFor(type, element));
    const body = { type, local_updated_at: stamp, created_at: stamp, ...element };
    writeFileSync(p, JSON.stringify(body, null, 2) + "\n");
    written.push(p);
  }
  return written;
}

/**
 * Backdrop-image media store for a Map element (R9). Mirrors how Atlas stores a
 * local map image on disk:
 *   media/<mapElementId>/base-image/<original filename>   (the image bytes)
 *   media/<mapElementId>/base-image/<mediaId>.meta.json   (the sidecar)
 * Copies the source image in and writes the sidecar. Returns written paths.
 */
export function writeMapMedia(dir, media, srcImagePath) {
  const baseDir = join(dir, "media", media.mapElementId, "base-image");
  mkdirSync(baseDir, { recursive: true });
  const imgDest = join(baseDir, media.filename);
  copyFileSync(srcImagePath, imgDest);
  const sizeBytes = statSync(imgDest).size;
  const sidecar = {
    id: media.mediaId,
    element_id: media.mapElementId,
    folder: "base-image",
    mime: media.mime,
    size_bytes: sizeBytes,
    added_at: media.addedAt,
  };
  const metaPath = join(baseDir, `${media.mediaId}.meta.json`);
  writeFileSync(metaPath, JSON.stringify(sidecar, null, 2) + "\n");
  return [imgDest, metaPath];
}
