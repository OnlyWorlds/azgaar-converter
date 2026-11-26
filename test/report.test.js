import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { mapAzgaar } from "../src/map.js";
import { leftBehind, leftBehindLines } from "../src/report.js";

const here = dirname(fileURLToPath(import.meta.url));
const OLDER = join(here, "..", "fixtures", "azgaar-export.json");
const REAL = join(here, "..", "fixtures", "real", "raroia-minimal-fmg-1.158.0.json");
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const report = (map) => leftBehind(map, mapAzgaar(map));

test("a real newer export: every part the converter never reads is named with its size", () => {
  const r = report(load(REAL));
  assert.deepEqual(r.unread, [
    { part: "pack.features", size: 12 },
    { part: "pack.biomes", size: 13 },
    { part: "pack.goods", size: 71 },
    { part: "pack.markets", size: 16 },
    { part: "pack.deals", size: 6894 },
    { part: "pack.routes", size: 444 },
    { part: "pack.zones", size: 17 },
    { part: "pack.measurers", size: 1 },
    { part: "pack.journeys", size: 1 },
    { part: "nameBases", size: 43 },
  ]);
  assert.equal(r.removed, 0);
  assert.equal(r.markersWithoutNote, 0);
  assert.equal(r.otherNotes, 0);
});

test("the older fixture: nothing unread, and what was passed over is counted", () => {
  const r = report(load(OLDER));
  assert.deepEqual(r.unread, []);
  assert.equal(r.removed, 1); // the removed burg
  assert.equal(r.markersWithoutNote, 1); // the Cave
  assert.equal(r.otherNotes, 1); // the note of a marker that is not there
  assert.deepEqual(leftBehindLines(r), [
    "passed over: 1 removed, 1 marker with no note, 1 note of no marker",
    'fields of a converted entry that are not carried: see the README, "Not converted"',
  ]);
});

test("a part nobody has seen before is named too, in pack and at the top", () => {
  const map = load(OLDER);
  map.pack.dragons = [{ i: 1 }, { i: 2 }, { i: 3 }];
  map.weather = { fronts: 2, storms: 1 };
  map.pack.empties = [];
  const r = report(map);
  assert.deepEqual(r.unread, [
    { part: "pack.dragons", size: 3 },
    { part: "weather", size: 2 },
  ]);
  assert.equal(leftBehindLines(r)[0], "not converted: pack.dragons (3), weather (2)");
});

test("a reserved first entry marked removed is not counted as passed over", () => {
  const map = load(OLDER);
  map.pack.states[0].removed = true;
  assert.equal(report(map).removed, 1);
});

test("zones and routes: the line about --geojson-dir is printed only without it", () => {
  const r = report(load(REAL));
  const hint = "  zones and routes are drawn only with --geojson-dir, from Azgaar's GeoJSON exports";
  assert.equal(leftBehindLines(r)[1], hint);
  assert.equal(leftBehindLines(r, { geojsonDir: "layers" }).includes(hint), false);
});

test("the command prints the count line and the report", () => {
  const out = mkdtempSync(join(tmpdir(), "azgaar-report-"));
  const printed = execFileSync(process.execPath, [join(here, "..", "src", "cli.js"), REAL, "--out", join(out, "world")], {
    encoding: "utf8",
  }).split(/\r?\n/);
  assert.equal(printed[0], "map: Raroia (FMG 1.158.0)");
  assert.ok(printed[1].startsWith("1133 elements "));
  assert.ok(printed[2].startsWith("not converted: pack.features (12), "));
  assert.ok(printed.includes('fields of a converted entry that are not carried: see the README, "Not converted"'));
});
