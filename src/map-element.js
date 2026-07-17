/**
 * Maps lane emitter (R2, R3, R5, R6, R8, R9, R10).
 *
 * Produces the Map element, one Pin per kept burg / FMG-marker (linked to that
 * settlement's existing Location), and Zones + ordered Marker chains for FMG
 * zones, rivers, and roads. Consumes the already-converted element items from
 * `mapAzgaar` to resolve links to their MINTED OW ids — this module never
 * re-mints a Location; it only points at ids the core mapping already made.
 *
 * On-disk contract (R2): Atlas's folder reader (`folder-store-fs.ts`) reads
 *   - Pin: { map_id, element_id, element_type: "location", x, y, name }
 *   - Marker: { map_id, zone_id, order, x, y }
 * The Folder Format spec's bare-name migration (map_id → map bare name, etc.)
 * is QUEUED but NOT shipped — we emit the id-suffixed keys Atlas reads today.
 * FUTURE FLIP: when the spec ships, these `*_id` keys become bare-name refs.
 *
 * Coordinates: pins come from pack pixel x,y directly; zone/marker geometry is
 * projected from the layer GeoJSON's lon/lat then y-inverted (see geometry.js).
 * All integers, native image-pixel space (R3, D2).
 */

import { uuidv7 } from "./ids.js";
import {
  lonLatToPixel,
  toOwPoint,
  simplifyToCap,
  largestRing,
  lineCoords,
  resolveZoneColor,
} from "./geometry.js";

// R4 caps by geometry class.
const CAP_ZONE_RING = 40;
const CAP_STATE_RING = 60; // reserved for state territories (skipped this bout, R7)
const CAP_LINE = 20;
const DP_TOLERANCE = 2.5; // px, R4 base

/**
 * Build a lookup from the converted core items: (x_azgaar_type, x_azgaar_id) ->
 * { id, name }. Only element types that carry azgaar provenance land here, which
 * is all of them — burgs, markers, rivers all resolve.
 */
function buildAzgaarIndex(items) {
  const index = new Map();
  const key = (t, id) => `${t}:${id}`;
  for (const { element } of items) {
    if (element.x_azgaar_type != null && element.x_azgaar_id != null) {
      index.set(key(element.x_azgaar_type, element.x_azgaar_id), {
        id: element.id,
        name: element.name,
      });
    }
  }
  return { get: (t, id) => index.get(key(t, id)) ?? null };
}

/**
 * Emit the maps-lane items. Returns { items, stats }.
 *   items: [{ type, element }] appended alongside the core conversion.
 *   stats: dropped-vertex + counts for the CLI summary (R4).
 *
 * @param map        parsed FMG export object (full or minimal JSON)
 * @param coreItems  output of mapAzgaar (for link resolution)
 * @param geojson    { zones, rivers, routes } parsed FeatureCollections (any may be null)
 * @param opts       { mintId, mapImage: { mediaId, filename, mime, sizeBytes, addedAt } | null,
 *                     provinces: bool, fullGeometry: bool }
 */
export function emitMaps(map, coreItems, geojson, opts = {}) {
  const mint = opts.mintId ?? uuidv7;
  const info = map.info ?? {};
  const settings = map.settings ?? {};
  const mc = map.mapCoordinates ?? {};
  const width = info.width ?? 0;
  const height = info.height ?? 0;
  const azIndex = buildAzgaarIndex(coreItems);

  const items = [];
  const stats = {
    pins: 0,
    zones: 0,
    lines: 0,
    markers: 0,
    verticesIn: 0,
    verticesOut: 0,
    ringsClipped: 0, // multipolygon zones reduced to largest ring
  };

  // --- Map element (R10) ----------------------------------------------------
  const mapId = mint();
  const worldName = info.mapName || "Azgaar Map";
  const mapEl = {
    id: mapId,
    name: `Map of ${worldName}`,
    width,
    height,
    location: null, // no world-root Location exists (R10)
    x_azgaar_seed: info.seed ?? null,
    x_azgaar_distance_scale: settings.distanceScale ?? null,
    x_azgaar_distance_unit: settings.distanceUnit ?? null,
  };
  if (opts.mapImage) mapEl.image_media_id = opts.mapImage.mediaId; // R9
  items.push({ type: "map", element: strip(mapEl) });

  // --- Pins (R8): every kept burg + kept FMG-marker -------------------------
  // We drive off the core Location elements so a pin exists iff its Location does
  // (burg/marker sentinels & removed are already filtered out of coreItems).
  for (const { element } of coreItems) {
    if (element.x_azgaar_type !== "burg" && element.x_azgaar_type !== "marker") continue;
    // pixel x,y live on the core element as x_azgaar_x / x_azgaar_y
    const xFmg = element.x_azgaar_x;
    const yFmg = element.x_azgaar_y;
    if (xFmg == null || yFmg == null) continue; // no placement → no pin (honest)
    const p = toOwPoint(xFmg, yFmg, height);
    items.push({
      type: "pin",
      element: strip({
        id: mint(),
        name: element.name,
        map_id: mapId,
        element_id: element.id,
        element_type: "location",
        x: p.x,
        y: p.y,
        x_azgaar_type: element.x_azgaar_type,
        x_azgaar_id: element.x_azgaar_id,
      }),
    });
    stats.pins++;
  }

  // --- shared ring/line → Zone + Marker chain emitter -----------------------
  const projectRing = (coords) =>
    coords.map((c) => {
      const { x, yFmg } = lonLatToPixel(c, mc, width, height);
      return toOwPoint(x, yFmg, height);
    });

  const emitZone = ({ name, role, shape, color, points, cap, azId, azType, locationRef, extra }) => {
    stats.verticesIn += points.length;
    const { points: simplified } = simplifyToCap(points, DP_TOLERANCE, cap);
    stats.verticesOut += simplified.length;
    const zoneId = mint();
    const zoneEl = {
      id: zoneId,
      name,
      atlas_shape: shape,
      atlas_color: color,
      x_azgaar_id: azId,
      x_azgaar_type: azType,
    };
    if (role) zoneEl.role = role;
    if (locationRef) zoneEl.x_azgaar_location_ref = locationRef; // R6
    if (extra) Object.assign(zoneEl, extra);
    items.push({ type: "zone", element: strip(zoneEl) });

    let order = 0;
    for (const pt of simplified) {
      items.push({
        type: "marker",
        element: strip({
          id: mint(),
          map_id: mapId,
          zone_id: zoneId,
          order: order++,
          x: pt.x,
          y: pt.y,
        }),
      });
      stats.markers++;
    }
    return zoneId;
  };

  // --- FMG zones (R5): polygons, default ON ---------------------------------
  if (geojson.zones) {
    for (const f of geojson.zones.features) {
      const g = f.geometry;
      if (g.type !== "Polygon" && g.type !== "MultiPolygon") continue;
      const { ring, ringCount } = largestRing(g);
      if (!ring || ring.length < 3) continue;
      if (ringCount > 1) stats.ringsClipped++;
      const props = f.properties ?? {};
      emitZone({
        name: props.name || `Zone ${props.id}`,
        role: props.type || null, // FMG type = role (R5)
        shape: "polygon",
        color: resolveZoneColor(props.color, props.type),
        points: projectRing(ring),
        cap: CAP_ZONE_RING,
        azId: props.id,
        azType: "zone",
        extra: ringCount > 1 ? { x_azgaar_rings: ringCount } : null,
      });
      stats.zones++;
    }
  }

  // --- Rivers (R6): lines, default ON, linked to river-Location -------------
  if (geojson.rivers) {
    for (const f of geojson.rivers.features) {
      const coords = lineCoords(f.geometry);
      if (!coords || coords.length < 2) continue;
      const props = f.properties ?? {};
      const twin = azIndex.get("river", props.id); // river.i === geojson id
      emitZone({
        name: props.name ? `${props.name}${props.type ? ` ${props.type}` : ""}` : `River ${props.id}`,
        role: "Waterway",
        shape: "line",
        color: "#3b82f6",
        points: projectRing(coords),
        cap: CAP_LINE,
        azId: props.id,
        azType: "river",
        locationRef: twin ? twin.id : null,
      });
      stats.lines++;
    }
  }

  // --- Routes (R6): roads default ON; trails/searoutes behind --full-geometry
  if (geojson.routes) {
    for (const f of geojson.routes.features) {
      const props = f.properties ?? {};
      const group = props.group;
      const isRoad = group === "roads";
      if (!isRoad && !opts.fullGeometry) continue; // only roads by default
      const coords = lineCoords(f.geometry);
      if (!coords || coords.length < 2) continue;
      emitZone({
        name: props.name || `${labelForRouteGroup(group)} ${props.id}`,
        role: "Road",
        shape: "line",
        color: "#a16207",
        points: projectRing(coords),
        cap: CAP_LINE,
        azId: props.id,
        azType: "route",
        // routes have no Location twin (R6) → no location_ref
        extra: group ? { x_azgaar_route_group: group } : null,
      });
      stats.lines++;
    }
  }

  return { items, stats };
}

function labelForRouteGroup(group) {
  if (group === "roads") return "Road";
  if (group === "trails") return "Trail";
  if (group === "searoutes") return "Sea Route";
  return "Route";
}

/**
 * Media sidecar + placement for the backdrop image (R9). Returns
 * { mediaId, mime, files: [{ relPath, srcPath | content }] } for the CLI to
 * write into the output folder. Pure — does no IO itself.
 */
export function buildMapMedia(mapElementId, imagePath, addedAt) {
  const filename = basename(imagePath);
  const mediaId = uuidv7();
  const mime = mimeFor(filename);
  return { mediaId, filename, mime, mapElementId, addedAt };
}

function mimeFor(filename) {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "svg") return "image/svg+xml";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function basename(p) {
  return String(p).replace(/\\/g, "/").split("/").pop();
}

function strip(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined || v === "") delete obj[k];
    else if (Array.isArray(v) && v.length === 0) delete obj[k];
  }
  return obj;
}
