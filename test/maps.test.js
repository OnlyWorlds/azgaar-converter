import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { mapAzgaar } from "../src/map.js";
import { emitMaps } from "../src/map-element.js";
import {
  douglasPeucker,
  simplifyToCap,
  lonLatToPixel,
  toOwPoint,
  resolveZoneColor,
  largestRing,
} from "../src/geometry.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "..", "fixtures", "azgaar-export.json");
const GEOJSON_DIR = join(here, "..", "fixtures", "geojson");

function loadFixture() {
  return JSON.parse(readFileSync(FIX, "utf8"));
}
function loadGeojson() {
  const f = (t) => JSON.parse(readFileSync(join(GEOJSON_DIR, `Thornevale ${t}.geojson`), "utf8"));
  return { zones: f("Zones"), rivers: f("Rivers"), routes: f("Routes") };
}
const seq = () => {
  let n = 0;
  return () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;
};

// --- geometry unit tests ---------------------------------------------------

test("douglas-peucker drops collinear points, keeps the meaningful bump", () => {
  // near-straight run with one real deviation at x=15
  const pts = [
    { x: 0, y: 0 },
    { x: 5, y: 0.1 },
    { x: 10, y: 0 },
    { x: 15, y: 5 },
    { x: 20, y: 0 },
  ];
  assert.deepEqual(douglasPeucker(pts, 1), [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 15, y: 5 },
    { x: 20, y: 0 },
  ]);
  // endpoints always survive; a 2-point line is returned as-is
  assert.deepEqual(douglasPeucker([{ x: 0, y: 0 }, { x: 9, y: 9 }], 5), [
    { x: 0, y: 0 },
    { x: 9, y: 9 },
  ]);
});

test("simplifyToCap raises tolerance until under the hard cap", () => {
  // a jagged 200-vertex zig-zag that base tolerance won't reduce enough
  const many = Array.from({ length: 200 }, (_, i) => ({ x: i, y: (i % 2) * 30 }));
  const r = simplifyToCap(many, 2.5, 20);
  assert.ok(r.points.length <= 20, `capped to <=20, got ${r.points.length}`);
  assert.ok(r.tolerance > 2.5, "tolerance was raised past the base");
});

test("y-inversion pins a known point (R3)", () => {
  // fixture projection: [lon,lat] -> pixel (lon, 300-lat) -> OW (lon, lat)
  const mc = { latT: 300, latN: 300, latS: 0, lonT: 400, lonW: 0, lonE: 400 };
  const { x, yFmg } = lonLatToPixel([60, 12], mc, 400, 300);
  assert.equal(x, 60);
  assert.equal(yFmg, 288);
  assert.deepEqual(toOwPoint(x, yFmg, 300), { x: 60, y: 12 });
  // a top-left FMG pixel maps to a high OW y (origin flips)
  assert.deepEqual(toOwPoint(0, 0, 300), { x: 0, y: 300 });
  assert.deepEqual(toOwPoint(0, 300, 300), { x: 0, y: 0 });
});

test("zone hatch colors fall back to flat by type; real colors pass through", () => {
  assert.equal(resolveZoneColor("url(#hatch1)", "Invasion"), "#8b0000");
  assert.equal(resolveZoneColor("url(#hatch3)", "Rebels"), "#22d3ee");
  assert.equal(resolveZoneColor("#4488cc", "Whatever"), "#4488cc");
});

test("largestRing picks the biggest outer ring of a multipolygon", () => {
  const geom = {
    type: "MultiPolygon",
    coordinates: [
      [[[0, 0], [1, 0], [1, 1]]], // 3-pt ring
      [[[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]]], // 5-pt ring (largest)
    ],
  };
  const { ring, ringCount } = largestRing(geom);
  assert.equal(ringCount, 2);
  assert.equal(ring.length, 5);
});

// --- emission integration tests --------------------------------------------

function emit(opts = {}) {
  const map = loadFixture();
  const core = mapAzgaar(map, { mintId: seq() });
  return emitMaps(map, core, loadGeojson(), { mintId: seq(), ...opts });
}

test("Map element carries dimensions, seed, scale, null location (R10)", () => {
  const { items } = emit();
  const mapEl = items.find((i) => i.type === "map").element;
  assert.equal(mapEl.name, "Map of Thornevale");
  assert.equal(mapEl.width, 400);
  assert.equal(mapEl.height, 300);
  assert.equal(mapEl.location ?? null, null); // stripped or explicit null
  assert.equal(mapEl.x_azgaar_seed, "482913");
  assert.equal(mapEl.x_azgaar_distance_scale, 3);
  assert.equal(mapEl.x_azgaar_distance_unit, "mi");
});

test("Pins: one per kept burg+marker, linked to the Location, y-inverted (R8)", () => {
  const map = loadFixture();
  const core = mapAzgaar(map, { mintId: seq() });
  const { items } = emitMaps(map, core, loadGeojson(), { mintId: seq() });
  const pins = items.filter((i) => i.type === "pin").map((i) => i.element);
  // 4 kept burgs (Ghosttown removed) + 1 marker with a note = 5 pins
  assert.equal(pins.length, 5);

  const locByName = new Map(
    core.filter((i) => i.type === "location").map((i) => [i.element.name, i.element]),
  );
  for (const pin of pins) {
    assert.equal(pin.element_type, "location");
    assert.equal(pin.map_id, items.find((i) => i.type === "map").element.id);
    const loc = locByName.get(pin.name);
    assert.ok(loc, `pin ${pin.name} names a real Location`);
    assert.equal(pin.element_id, loc.id, "pin links the Location's minted id");
    assert.ok(Number.isInteger(pin.x) && Number.isInteger(pin.y));
  }
  // Aldor City is at pixel (120,90) on a 300-tall canvas → OW y = 300-90 = 210
  const aldor = pins.find((p) => p.name === "Aldor City");
  assert.equal(aldor.x, 120);
  assert.equal(aldor.y, 210);
});

test("Zone + Marker chain: order integrity, map_id/zone_id wiring (R5)", () => {
  const { items } = emit();
  const zones = items.filter((i) => i.type === "zone").map((i) => i.element);
  const zone = zones.find((z) => z.name === "The Riven Coast");
  assert.ok(zone, "FMG zone emitted");
  assert.equal(zone.role, "Rebels"); // FMG type = role
  assert.equal(zone.atlas_shape, "polygon");
  assert.equal(zone.atlas_color, "#22d3ee"); // hatch3 non-Invasion fallback
  assert.equal(zone.x_azgaar_type, "zone");

  const mapId = items.find((i) => i.type === "map").element.id;
  const chain = items
    .filter((i) => i.type === "marker" && i.element.zone_id === zone.id)
    .map((i) => i.element);
  assert.ok(chain.length >= 3, "polygon ring has markers");
  chain.sort((a, b) => a.order - b.order);
  chain.forEach((m, idx) => {
    assert.equal(m.order, idx, "orders are contiguous from 0");
    assert.equal(m.map_id, mapId);
    assert.equal(m.zone_id, zone.id);
    assert.ok(Number.isInteger(m.x) && Number.isInteger(m.y));
  });
});

test("Rivers → Waterway Zone linked to river Location via x_azgaar_location_ref (R6)", () => {
  const map = loadFixture();
  const core = mapAzgaar(map, { mintId: seq() });
  const { items } = emitMaps(map, core, loadGeojson(), { mintId: seq() });
  const river = items
    .filter((i) => i.type === "zone")
    .map((i) => i.element)
    .find((z) => z.role === "Waterway");
  assert.ok(river, "river zone emitted");
  assert.equal(river.atlas_shape, "line");
  const riverLoc = core.find((i) => i.element.x_azgaar_type === "river").element;
  assert.equal(river.x_azgaar_location_ref, riverLoc.id, "linked to the river's Location twin");
});

test("Routes: roads default ON, trails only with --full-geometry (R6)", () => {
  const roadsOnly = emit();
  const roadZones = roadsOnly.items
    .filter((i) => i.type === "zone")
    .map((i) => i.element)
    .filter((z) => z.role === "Road");
  assert.equal(roadZones.length, 1, "only the roads-group route by default");
  assert.equal(roadZones[0].x_azgaar_route_group, "roads");
  // routes have no Location twin → no location_ref
  assert.equal(roadZones[0].x_azgaar_location_ref, undefined);

  const full = emit({ fullGeometry: true });
  const allRoutes = full.items
    .filter((i) => i.type === "zone")
    .map((i) => i.element)
    .filter((z) => z.x_azgaar_type === "route");
  assert.equal(allRoutes.length, 2, "roads + trails with --full-geometry");
});

test("dropped-vertex stats are recorded", () => {
  const { stats } = emit();
  assert.ok(stats.verticesIn >= stats.verticesOut);
  assert.ok(stats.pins === 5);
  assert.ok(stats.zones === 1);
  assert.ok(stats.lines === 2); // 1 river + 1 road
  assert.ok(stats.markers > 0);
});

test("CLI maps lane end-to-end: media sidecar shape + pin/zone/marker files (R9)", () => {
  const out = mkdtempSync(join(tmpdir(), "azgaar-maps-"));
  // a tiny fake image to exercise the media store
  const imgPath = join(out, "backdrop.png");
  execFileSync(process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(imgPath)}, 'PNGDATA')`]);

  execFileSync(process.execPath, [
    join(here, "..", "src", "cli.js"),
    FIX,
    "--out",
    join(out, "world"),
    "--geojson-dir",
    GEOJSON_DIR,
    "--map-image",
    imgPath,
  ]);

  const worldDir = join(out, "world");
  const mapFiles = readdirSync(join(worldDir, "spatial", "map"));
  assert.equal(mapFiles.length, 1);
  const mapEl = JSON.parse(readFileSync(join(worldDir, "spatial", "map", mapFiles[0]), "utf8"));
  assert.ok(mapEl.image_media_id, "map links a media id");

  // media store on disk: media/<mapId>/base-image/<file> + <mediaId>.meta.json (R9)
  const baseDir = join(worldDir, "media", mapEl.id, "base-image");
  assert.ok(existsSync(join(baseDir, "backdrop.png")), "image copied in");
  const metaFile = readdirSync(baseDir).find((f) => f.endsWith(".meta.json"));
  const meta = JSON.parse(readFileSync(join(baseDir, metaFile), "utf8"));
  assert.equal(meta.id, mapEl.image_media_id);
  assert.equal(meta.element_id, mapEl.id);
  assert.equal(meta.folder, "base-image");
  assert.equal(meta.mime, "image/png");
  assert.equal(meta.size_bytes, 7); // "PNGDATA"
  assert.ok(meta.added_at, "added_at present");

  // pins + zones + markers all present as folder elements
  assert.equal(readdirSync(join(worldDir, "spatial", "pin")).length, 5);
  assert.ok(readdirSync(join(worldDir, "spatial", "zone")).length >= 3);
  assert.ok(readdirSync(join(worldDir, "spatial", "marker")).length > 0);
});

test("--heraldry: states get armoria-api emblem image_url from their coa; off by default", async () => {
  const { mapAzgaar } = await import("../src/map.js");
  const fixture = JSON.parse(readFileSync(FIX, "utf8"));
  // give one state a coa spec (synthetic fixture may not carry one)
  fixture.pack.states[1].coa = { t1: "azure", shield: "oval", charges: [{ charge: "saw", t: "or" }] };

  const on = mapAzgaar(fixture, { heraldry: true });
  const aldoria = on.find((i) => i.element.name === "Aldoria").element;
  assert.ok(aldoria.image_url.startsWith("https://armoria.herokuapp.com/png/300/?coa="), "emblem URL set");
  assert.ok(decodeURIComponent(aldoria.image_url).includes('"t1":"azure"'), "coa spec encoded in URL");
  // a state without a coa gets no image_url even with the flag
  const weshelm = on.find((i) => i.element.name === "Weshelm").element;
  assert.ok(!("image_url" in weshelm));

  const off = mapAzgaar(fixture, {});
  assert.ok(!("image_url" in off.find((i) => i.element.name === "Aldoria").element), "off by default");
});

test("bulk payload speaks the API wire dialect: bare map/zone links, no Atlas-local fields", () => {
  const out = mkdtempSync(join(tmpdir(), "azgaar-bulk-"));
  const imgPath = join(out, "backdrop.png");
  execFileSync(process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(imgPath)}, 'PNGDATA')`]);
  const bulkPath = join(out, "payload.json");

  execFileSync(process.execPath, [
    join(here, "..", "src", "cli.js"),
    FIX,
    "--out",
    join(out, "world"),
    "--bulk",
    bulkPath,
    "--geojson-dir",
    GEOJSON_DIR,
    "--map-image",
    imgPath,
  ]);

  const bulk = JSON.parse(readFileSync(bulkPath, "utf8"));
  const pins = bulk.items.filter((i) => i.type === "pin");
  const markers = bulk.items.filter((i) => i.type === "marker");
  const mapEl = bulk.items.find((i) => i.type === "map").element;
  assert.ok(pins.length > 0 && markers.length > 0);
  for (const { element } of [...pins, ...markers]) {
    assert.ok(!("map_id" in element), "bulk uses bare map, not map_id");
    assert.equal(typeof element.map, "string");
  }
  for (const { element } of markers) {
    assert.ok(!("zone_id" in element), "bulk uses bare zone, not zone_id");
    assert.equal(typeof element.zone, "string");
  }
  // generic element link IS the wire shape — stays as element_type/element_id
  assert.equal(pins[0].element.element_type, "location");
  assert.equal(typeof pins[0].element.element_id, "string");
  // Atlas-local field never goes to the API
  assert.ok(!("image_media_id" in mapEl), "image_media_id stripped from bulk");

  // and the FOLDER written in the same run still carries Atlas's dialect
  const pinDir = join(out, "world", "spatial", "pin");
  const folderPin = JSON.parse(readFileSync(join(pinDir, readdirSync(pinDir)[0]), "utf8"));
  assert.ok("map_id" in folderPin, "folder keeps map_id for today's Atlas reader");
});
