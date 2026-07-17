#!/usr/bin/env node
/**
 * azgaar-to-world — convert an Azgaar Fantasy Map Generator JSON export (.map
 * saved as JSON, or the Full/Minimal .json export) into an OnlyWorlds world
 * folder and/or a POST /api/v2/bulk payload.
 *
 * Usage:
 *   node src/cli.js <export.json> --out <world-folder-dir>
 *                   [--bulk <payload.json>] [--world-name <name>]
 *                   [--geojson-dir <dir>] [--map-image <path>]
 *                   [--provinces] [--full-geometry] [--help]
 *
 * Output modes (either or both):
 *   --out    write an OnlyWorlds Folder Format world folder (open it in Atlas)
 *   --bulk   write a POST /api/v2/bulk payload ({ items: [{type, element}] })
 *            — push it with your own world key: the converter never talks to
 *            the network and never needs an account.
 *
 * Maps lane (v2):
 *   --geojson-dir  a directory of FMG's own per-layer GeoJSON exports (filenames
 *                  contain Zones|Rivers|Routes|Markers|Cells, matched
 *                  case-insensitively). Adds a Map, Pins, and Zone+Marker chains
 *                  for FMG zones + all rivers + roads-group routes.
 *   --map-image    a backdrop image (svg/png/jpg); copied into the folder's
 *                  media store and linked to the Map element.
 *   --provinces    also emit province territories (reserved; see report).
 *   --full-geometry  also emit trails/searoutes (default: roads only).
 *   --heraldry     set state Institutions' image_url to armoria-api emblem
 *                  renders of their coat-of-arms specs (opt-in; uses Azgaar's
 *                  hosted API).
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mapAzgaar } from "./map.js";
import { writeWorldFolder, writeMapMedia } from "./folder.js";
import { emitMaps, buildMapMedia } from "./map-element.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--bulk") args.bulk = argv[++i];
    else if (a === "--world-name") args.worldName = argv[++i];
    else if (a === "--geojson-dir") args.geojsonDir = argv[++i];
    else if (a === "--map-image") args.mapImage = argv[++i];
    else if (a === "--provinces") args.provinces = true;
    else if (a === "--full-geometry") args.fullGeometry = true;
    else if (a === "--heraldry") args.heraldry = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

/** Find a GeoJSON layer file in dir whose name contains a token (R7). */
function findLayer(dir, files, token) {
  const re = new RegExp(token, "i");
  const hit = files.find((f) => re.test(f) && f.toLowerCase().endsWith(".geojson"));
  return hit ? JSON.parse(readFileSync(join(dir, hit), "utf8")) : null;
}

function loadGeojson(dir) {
  const files = readdirSync(dir);
  return {
    zones: findLayer(dir, files, "Zones"),
    rivers: findLayer(dir, files, "Rivers"),
    routes: findLayer(dir, files, "Routes"),
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._.length !== 1 || (!args.out && !args.bulk)) {
  console.log(
    "Usage: node src/cli.js <export.json> --out <dir> [--bulk <payload.json>] [--world-name <name>]\n" +
      "                       [--geojson-dir <dir>] [--map-image <path>] [--provinces] [--full-geometry] [--heraldry]",
  );
  process.exit(args.help ? 0 : 1);
}

const t0 = Date.now();
const map = JSON.parse(readFileSync(args._[0], "utf8"));
const items = mapAzgaar(map, { heraldry: args.heraldry });
const worldName = args.worldName || map.info?.mapName || "Azgaar Import";

// --- maps lane -------------------------------------------------------------
let mapsStats = null;
let media = null;
if (args.geojsonDir) {
  const geojson = loadGeojson(args.geojsonDir);
  const info = map.info ?? {};
  if (args.mapImage) {
    // build media metadata now so the Map element can carry image_media_id; the
    // bytes are copied after the folder is written (R9).
    const addedAt = info.exportedAt || new Date().toISOString();
    // mapElementId is minted inside emitMaps; we mint media there via emitMaps opts.
    media = { pending: true, imagePath: args.mapImage, addedAt };
  }
  // emitMaps mints the Map id; to link media we let it accept a pre-built media
  // descriptor. Two-phase: emit once to learn the map id, then attach media.
  const firstPass = emitMaps(map, items, geojson, {
    provinces: args.provinces,
    fullGeometry: args.fullGeometry,
    mapImage: null,
  });
  const mapEl = firstPass.items.find((i) => i.type === "map").element;
  if (media?.pending) {
    const built = buildMapMedia(mapEl.id, media.imagePath, media.addedAt);
    mapEl.image_media_id = built.mediaId;
    media = { ...built, imagePath: args.mapImage };
  }
  items.push(...firstPass.items);
  mapsStats = firstPass.stats;
}

console.log(`map: ${map.info?.mapName ?? "(unnamed)"} (FMG ${map.info?.version ?? "?"})`);
const byType = {};
for (const { type } of items) byType[type] = (byType[type] ?? 0) + 1;
console.log(`elements: ${items.length} —`, JSON.stringify(byType));
if (mapsStats) {
  const dropped = mapsStats.verticesIn - mapsStats.verticesOut;
  const pct = mapsStats.verticesIn ? ((dropped / mapsStats.verticesIn) * 100).toFixed(1) : "0.0";
  console.log(
    `maps: ${mapsStats.pins} pins, ${mapsStats.zones} zones, ${mapsStats.lines} lines, ` +
      `${mapsStats.markers} markers; vertices ${mapsStats.verticesIn}->${mapsStats.verticesOut} ` +
      `(${dropped} dropped, ${pct}%); ${mapsStats.ringsClipped} multipolygon zones clipped to largest ring`,
  );
  if (!args.mapImage) {
    console.log(
      "NOTE: no --map-image given. Atlas gates PIN PLACEMENT (drawing new pins) on an " +
        "image being present, but still RENDERS existing pins. Pins here are emitted; " +
        "supply --map-image for the backdrop.",
    );
  }
}

if (args.out) {
  const written = writeWorldFolder(args.out, worldName, items);
  console.log(`world folder: ${args.out} (${written.length} files)`);
  if (media && !media.pending) {
    const mediaWritten = writeMapMedia(args.out, media, media.imagePath);
    console.log(`map media: ${mediaWritten.length} files under media/${media.mapElementId}/base-image/`);
  }
}
if (args.bulk) {
  // Dialect seam: the FOLDER carries the keys Atlas's reader wants today
  // (map_id / zone_id), but the v2 API wire uses the schema's bare single-link
  // names (map / zone). image_media_id is Atlas-local and never goes to the API.
  // The generic element link (element_type + element_id) is the wire shape
  // already. Translate on the way out; the folder items stay untouched.
  const wireItems = items.map(({ type, element }) => {
    if (type !== "pin" && type !== "marker" && type !== "map") return { type, element };
    const el = { ...element };
    if ("map_id" in el) {
      el.map = el.map_id;
      delete el.map_id;
    }
    if ("zone_id" in el) {
      el.zone = el.zone_id;
      delete el.zone_id;
    }
    delete el.image_media_id;
    return { type, element: el };
  });
  writeFileSync(args.bulk, JSON.stringify({ items: wireItems }, null, 2) + "\n");
  console.log(`bulk payload: ${args.bulk} (POST /api/v2/bulk with your world key)`);
}

console.log(`done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
