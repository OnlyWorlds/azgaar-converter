import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { mapAzgaar } from "../src/map.js";
import { emitMaps } from "../src/map-element.js";
import { MADE_NAMES, fits, madeCounts, madeLines } from "../src/made.js";

const here = dirname(fileURLToPath(import.meta.url));
const OLDER = join(here, "..", "fixtures", "azgaar-export.json");
const REAL = join(here, "..", "fixtures", "real", "raroia-minimal-fmg-1.158.0.json");
const load = (path) => JSON.parse(readFileSync(path, "utf8"));
const declared = new Map(MADE_NAMES.map((m) => [m.kind, m]));

test("a real export: the names made are counted by kind, the rest taken whole", () => {
  const items = mapAzgaar(load(REAL));
  assert.deepEqual(madeCounts(items), { "import-record": 1, diplomacy: 48, "river-typed": 154 });
  // every made name fits its own kind, and no made Relation, Construct or river goes uncounted
  for (const i of items.filter((i) => i.made)) assert.ok(fits(declared.get(i.made), i.type, i.element.name), i.element.name);
  assert.equal(items.filter((i) => i.type === "relation" && !i.made).length, 0);
  assert.equal(items.filter((i) => i.type === "construct" && !i.made).length, 0);
});

test("the count rides beside the element, never in it", () => {
  const items = mapAzgaar(load(REAL));
  for (const { element } of items) {
    assert.ok(!("made" in element) && !("__made" in element), element.name);
  }
});

test("a name the export does not give is ours: River <n>, Burg <n>, State <n>, and a Pin that copies a Burg <n>", () => {
  const map = load(OLDER);
  const river = map.pack.rivers.find((r) => r && r.i !== 0 && r.removed !== true);
  river.name = "";
  const burg = map.pack.burgs.find((b, i) => i !== 0 && b && b.removed !== true && b.x != null);
  burg.name = "";
  const state = map.pack.states.find((s, i) => i !== 0 && s && s.removed !== true);
  state.name = "";
  const items = mapAzgaar(map);
  const counts = madeCounts(items);
  assert.equal(counts["river-unnamed"], 1);
  assert.equal(counts["burg-unnamed"], 1);
  assert.equal(counts["state-unnamed"], 1);
  const all = [...items, ...emitMaps(map, items, {}, {}).items];
  const pins = all.filter((i) => i.type === "pin" && i.made === "pin-burg-unnamed");
  assert.equal(pins.length, 1);
  assert.equal(pins[0].element.name, `Burg ${burg.i}`);
  const mapItem = all.find((i) => i.type === "map");
  assert.equal(mapItem.made, map.info.mapName ? "map" : "map-unnamed");
});

test("a kind the converter does not declare is refused, and the lines read as the doors' do", () => {
  assert.throws(() => madeCounts([{ type: "location", element: {}, made: "nobody" }]), /does not declare/);
  assert.deepEqual(madeLines({}), []);
  assert.deepEqual(madeLines({ "import-record": 1, "river-unnamed": 2 }), [
    "Names made by the import, not taken whole from the export (3), one line a kind:",
    "  - import-record, construct '<map> (Azgaar import)': 1 (joined: the export's words, ours between them)",
    "  - river-unnamed, location 'River <n>': 2 (ours: the export gives it no name)",
  ]);
});

test("the kinds are well formed: unique ids, a source of two, a regex both languages read", () => {
  assert.equal(declared.size, MADE_NAMES.length);
  for (const m of MADE_NAMES) {
    assert.match(m.kind, /^[a-z0-9-]+$/);
    assert.ok(m.source === "joined" || m.source === "ours", m.kind);
    assert.equal(typeof m.regex, "string", m.kind);
    assert.ok(!m.regex.startsWith("^") && !m.regex.endsWith("$"), m.kind);
  }
});

test("the command prints the names made, once, after the count line", () => {
  const out = mkdtempSync(join(tmpdir(), "azgaar-made-"));
  const printed = execFileSync(process.execPath, [join(here, "..", "src", "cli.js"), REAL, "--out", join(out, "world")], {
    encoding: "utf8",
  });
  const lines = printed.split(/\r?\n/);
  const at = lines.findIndex((l) => l.startsWith("Names made by the import"));
  assert.ok(at > lines.findIndex((l) => / elements /.test(l)));
  assert.equal(lines[at], "Names made by the import, not taken whole from the export (203), one line a kind:");
  assert.equal(lines.filter((l) => l.startsWith("Names made by the import")).length, 1);
  // nothing written holds the count
  const dir = join(out, "world", "elements", "relation");
  const body = readFileSync(join(dir, readdirSync(dir)[0]), "utf8");
  assert.ok(!body.includes('"made"') && !body.includes("__made"));
});
