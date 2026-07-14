import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { mapAzgaar, htmlToText } from "../src/map.js";
import { slugify, filenameFor } from "../src/folder.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "..", "fixtures", "azgaar-export.json");

function loadFixture() {
  return JSON.parse(readFileSync(FIX, "utf8"));
}

const seq = () => {
  let n = 0;
  return () => `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`;
};

test("fixture exists (run node fixtures/make_fixture.js first)", () => {
  assert.ok(existsSync(FIX));
});

test("htmlToText strips tags and decodes entities", () => {
  assert.equal(
    htmlToText("<p>A shrine to <b>Maren</b>&#39;s deep.</p>"),
    "A shrine to Maren's deep.",
  );
  assert.equal(htmlToText(null), "");
});

test("folder naming: slug + always-tail, diacritics folded, presentation-only", () => {
  assert.equal(slugify("Vešmar"), "vesmar");
  assert.equal(slugify("The Kingdom of Aldoria"), "the-kingdom-of-aldoria");
  const el = { id: "01920000-aaaa-7bbb-8ccc-1234567890ab", name: "Aldoria!" };
  assert.equal(filenameFor("location", el), "aldoria--567890ab.json");
  const unnamed = { id: "01920000-aaaa-7bbb-8ccc-1234567890ab", name: "!!!" };
  assert.equal(filenameFor("location", unnamed), "location--567890ab.json");
});

test("mapAzgaar: full constellation, sentinels + removed skipped", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });

  const byType = {};
  for (const { type } of items) byType[type] = (byType[type] ?? 0) + 1;
  // 1 import Construct; 3 states + 2 religions = 5 Institution; 2 Relation
  // (Enemy deduped from mutual, Vassalage from Vassal/Suzerain); 1 Event;
  // 2 provinces + 4 burgs (removed one gone) + 1 river + 1 marker = 8 Location;
  // 2 cultures = 2 Collective.
  assert.deepEqual(byType, {
    construct: 1,
    institution: 5,
    relation: 2,
    event: 1,
    location: 8,
    collective: 2,
  });

  const name = (n) => items.find((i) => i.element.name === n)?.element;
  const byAz = (kind) => items.filter((i) => i.element.x_azgaar_type === kind).map((i) => i.element);

  // sentinel 0 never becomes an element in any indexed array
  assert.equal(name("Wildlands"), undefined);
  assert.equal(name("Neutrals"), undefined);
  assert.equal(name("No religion"), undefined);
  // removed burg filtered out
  assert.equal(name("Ghosttown"), undefined);
});

test("port is non-boolean: id != 0 is a port, 0 is not; subtype precedence", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const burg = (n) => items.find((i) => i.element.name === n).element;

  // capital wins over port even though Aldor City has port id 7
  assert.equal(burg("Aldor City").subtype, "Capital");
  assert.equal(burg("Aldor City").x_azgaar_port, 7);
  // plain burg with a water-feature port id → Port
  assert.equal(burg("Saltmere").subtype, "Port");
  assert.equal(burg("Saltmere").x_azgaar_port, 4);
  // port 0 is NOT a port → falls to population tier (small → Village)
  assert.equal(burg("Downhollow").subtype, "Village");
  assert.equal(burg("Downhollow").x_azgaar_port, undefined);
});

test("population scales by populationRate * urbanization, raw preserved", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const aldor = items.find((i) => i.element.name === "Aldor City").element;
  // 24 * 1000 * 1.0 = 24000
  assert.ok(aldor.description.includes("approx 24000 people"));
  assert.equal(aldor.x_azgaar_population_raw, 24);
});

test("diplomacy → strong ties only, pairs deduped, vassalage collapsed", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const rels = items.filter((i) => i.type === "relation").map((i) => i.element);
  assert.equal(rels.length, 2);

  const enmity = rels.find((r) => r.x_azgaar_status === "Enemy");
  assert.ok(enmity, "one Enemy relation");
  assert.equal(enmity.name, "Aldoria–Weshelm: Enmity");
  assert.equal(enmity.institutions.length, 2); // both sides linked

  const vass = rels.find((r) => r.x_azgaar_status === "Vassalage");
  assert.ok(vass, "one Vassalage relation");
  assert.equal(vass.name, "Weshelm–Kestrel March: Vassalage");
  assert.equal(vass.institutions.length, 2);

  // Neutral never becomes a Relation
  assert.ok(!rels.some((r) => r.x_azgaar_status === "Neutral"));
});

test("diplomacy also fills native Institution allies/adversaries (vassalage does not)", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const name = (n) => items.find((i) => i.element.name === n).element;
  const aldoria = name("Aldoria");
  const weshelm = name("Weshelm");
  const kestrel = name("Kestrel March");

  // Aldoria–Weshelm are Enemies → adversaries both ways, no allies
  assert.ok(aldoria.adversaries?.includes(weshelm.id));
  assert.ok(weshelm.adversaries?.includes(aldoria.id));
  assert.ok(!aldoria.allies?.includes(weshelm.id));

  // Weshelm–Kestrel March is Vassalage → Relation only, NOT allies/adversaries
  assert.ok(!weshelm.allies?.includes(kestrel.id));
  assert.ok(!weshelm.adversaries?.includes(kestrel.id));
  assert.ok(!kestrel.adversaries?.includes(weshelm.id));
});

test("links resolve to minted UUIDs inside the batch", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const name = (n) => items.find((i) => i.element.name === n).element;

  // province → its state via primary_power (Aldoria is the state Institution)
  assert.equal(name("Coastward Province").primary_power, name("Aldoria").id);
  // capital burg → its province via parent_location
  assert.equal(name("Aldor City").parent_location, name("Coastward Province").id);
  // burg → state via primary_power
  assert.equal(name("Saltmere").primary_power, name("Aldoria").id);
  // burg → its culture via the native populations link
  const someBurg = items.find((i) => i.element.x_azgaar_type === "burg" && i.element.populations);
  assert.ok(someBurg, "at least one burg links its culture via populations");
  const cultureIds = items
    .filter((i) => i.element.x_azgaar_type === "culture")
    .map((i) => i.element.id);
  assert.ok(someBurg.element.populations.every((id) => cultureIds.includes(id)));

  // event belligerents: both states resolved (aggressor + rival)
  const war = items.find((i) => i.type === "event").element;
  assert.equal(war.name, "The Salt War");
  assert.equal(war.institutions.length, 2);
  assert.ok(war.institutions.includes(name("Aldoria").id));
  assert.ok(war.institutions.includes(name("Weshelm").id));

  // every element carries provenance + a string id
  for (const { element } of items) {
    assert.equal(typeof element.id, "string");
    assert.ok(element.x_azgaar_type !== undefined);
  }
});

test("marker+note pairing: only markers WITH a note become Locations", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const markers = items.filter((i) => i.element.x_azgaar_type === "marker").map((i) => i.element);
  assert.equal(markers.length, 1); // Cave had no note → skipped; orphan note made nothing
  assert.equal(markers[0].name, "The Drowned Chapel");
  assert.equal(markers[0].supertype, "Landmark");
  assert.ok(markers[0].description.includes("Maren of the Deep"));
});

test("import-record Construct captures seed + version", () => {
  const items = mapAzgaar(loadFixture(), { mintId: seq() });
  const rec = items.find((i) => i.type === "construct").element;
  assert.equal(rec.name, "Thornevale (Azgaar import)");
  assert.ok(rec.description.includes("482913"));
  assert.ok(rec.description.includes("1.99.00"));
});

test("CLI end-to-end: export in, world folder + bulk payload out", () => {
  const out = mkdtempSync(join(tmpdir(), "azgaar-conv-"));
  const bulkPath = join(out, "bulk.json");
  execFileSync(process.execPath, [
    join(here, "..", "src", "cli.js"),
    FIX,
    "--out",
    join(out, "world"),
    "--bulk",
    bulkPath,
  ]);

  const world = JSON.parse(readFileSync(join(out, "world", "world.json"), "utf8"));
  assert.equal(world.name, "Thornevale");

  const locFiles = readdirSync(join(out, "world", "elements", "location"));
  assert.equal(locFiles.length, 8);
  const instFiles = readdirSync(join(out, "world", "elements", "institution"));
  assert.equal(instFiles.length, 5);

  const bulk = JSON.parse(readFileSync(bulkPath, "utf8"));
  assert.ok(Array.isArray(bulk.items));
  assert.equal(bulk.items.length, 19);
  assert.ok(bulk.items.every((i) => i.type && i.element && i.element.id));
});
