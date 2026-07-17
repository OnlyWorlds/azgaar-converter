/**
 * Synthetic Azgaar FMG export fixture — original SFW content, shaped to match
 * the Minimal-export structure (info, settings, pack{...}, notes). Exercises
 * every mapping ruling: sentinel-0 in all five indexed arrays, a diplomacy
 * matrix with Ally/Enemy/Vassal+Suzerain/Neutral, a named campaign, removed
 * burg, non-boolean port, a marker with an HTML-legend note (and one without),
 * and diacritics for the slug test.
 *
 * Run: node fixtures/make_fixture.js
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const map = {
  info: {
    version: "1.99.00",
    mapName: "Thornevale",
    seed: "482913",
    exportedAt: "2026-07-14T00:00:00.000Z",
    // image-pixel canvas (maps lane R3/R10)
    width: 400,
    height: 300,
  },
  // Projection block chosen so lon/lat map cleanly to pixels for the geometry
  // tests: lonW=0,lonT=400 → x_fmg = lon; latN=300,latT=300 → y_fmg = 300 - lat,
  // so after R3 inversion y_ow = lat. (pixel_x == lon, ow_y == lat.)
  mapCoordinates: { latT: 300, latN: 300, latS: 0, lonT: 400, lonW: 0, lonE: 400 },
  settings: {
    populationRate: 1000,
    urbanization: 1.0,
    distanceScale: 3,
    distanceUnit: "mi",
  },
  pack: {
    // index 0 is the "Wildlands" sentinel — never an element
    cultures: [
      { i: 0, name: "Wildlands", type: "" },
      { i: 1, name: "Aldori", type: "Highland" },
      { i: 2, name: "Vešmar", type: "Nomadic" }, // diacritic → slug test
    ],
    // index 0 is the empty-burg sentinel
    burgs: [
      { i: 0 },
      // capital, port (port is a water-feature id, not a bool), big pop → but Capital wins
      { i: 1, name: "Aldor City", state: 1, culture: 1, capital: 1, port: 7, population: 24, x: 120, y: 90 },
      // plain port, mid pop → Port (port wins over pop tier)
      { i: 2, name: "Saltmere", state: 1, culture: 1, capital: 0, port: 4, population: 8, x: 140, y: 110 },
      // plain inland, small pop → Village
      { i: 3, name: "Downhollow", state: 2, culture: 2, capital: 0, port: 0, population: 2, x: 200, y: 60 },
      // capital of state 2
      { i: 4, name: "Weshelm Keep", state: 2, culture: 2, capital: 1, port: 0, population: 30, x: 210, y: 55 },
      // removed → filtered
      { i: 5, name: "Ghosttown", state: 2, culture: 2, capital: 0, port: 0, population: 5, removed: true },
    ],
    // index 0 is "Neutrals" sentinel; diplomacy arrays indexed by state id
    states: [
      { i: 0, name: "Neutrals" },
      {
        i: 1,
        name: "Aldoria",
        fullName: "The Kingdom of Aldoria",
        form: "Monarchy",
        formName: "Kingdom",
        capital: 1,
        culture: 1,
        area: 4200,
        rural: 18000,
        urban: 3200,
        // dip[0]=self-neutral placeholder region, dip[1]=self, dip[2]=Enemy of Weshelm
        diplomacy: ["x", "x", "Enemy"],
        // Real 1.13x shape: attacker/defender ids. Shared war listed VERBATIM in
        // both belligerents' arrays → must dedupe to ONE Event.
        campaigns: [{ name: "The Salt War", start: 511, end: 514, attacker: 1, defender: 2 }],
      },
      {
        i: 2,
        name: "Weshelm",
        fullName: "The Weshelm Protectorate",
        form: "Republic",
        formName: "Protectorate",
        capital: 4,
        culture: 2,
        area: 2100,
        rural: 9000,
        urban: 1800,
        // Enemy of Aldoria (mutual → must dedupe to ONE Relation),
        // Suzerain over state 3 (vassalage)
        diplomacy: ["x", "Enemy", "x", "Suzerain"],
        // The Salt War also listed here (shared-war dedupe test), plus a legacy
        // `rival`-field campaign with no `end` (ongoing war, pre-attacker/defender).
        campaigns: [
          { name: "The Salt War", start: 511, end: 514, attacker: 1, defender: 2 },
          { name: "The Old Feud", start: 300, rival: 1 },
        ],
      },
      {
        i: 3,
        name: "Kestrel March",
        fullName: "The March of Kestrel",
        form: "Monarchy",
        formName: "Duchy",
        capital: 0,
        culture: 2,
        area: 800,
        rural: 3000,
        urban: 200,
        // Vassal of Weshelm (mutual with state 2's Suzerain → ONE Vassalage Relation),
        // Neutral toward Aldoria (skipped)
        diplomacy: ["x", "Neutral", "Vassal", "x"],
      },
    ],
    // index 0 sentinel
    provinces: [
      { i: 0, name: "" },
      { i: 1, name: "Coastward", fullName: "Coastward Province", formName: "Province", state: 1, burg: 1 },
      { i: 2, name: "Highreach", fullName: "Highreach Province", formName: "March", state: 2, burg: 4 },
    ],
    // index 0 is "No religion" sentinel
    religions: [
      { i: 0, name: "No religion" },
      { i: 1, name: "The Tide Compact", type: "Organized", form: "Polytheism", deity: "Maren of the Deep", culture: 1 },
      { i: 2, name: "Hearthfaith", type: "Folk", form: "Animism", deity: "The Hearth-Mother", culture: 2 },
    ],
    // keyed by .i, unordered; i:0 reserved
    rivers: [
      { i: 0 },
      { i: 3, name: "Saltrun", type: "River", length: 180, discharge: 42 },
    ],
    // keyed by .i; only markers with a matching "marker<i>" note become elements
    markers: [
      { i: 1, type: "Ruins", x: 155, y: 95 },
      { i: 2, type: "Cave", x: 300, y: 220 }, // no note → skipped
    ],
  },
  notes: [
    {
      id: "marker1",
      name: "The Drowned Chapel",
      legend: "<p>A tide-worn shrine to <b>Maren of the Deep</b>, submerged at each high water.</p>",
    },
    // note for a non-existent marker — should not create anything
    { id: "marker99", name: "Orphan Note", legend: "<p>No marker owns this.</p>" },
  ],
};

const out = join(here, "azgaar-export.json");
writeFileSync(out, JSON.stringify(map, null, 2) + "\n");
console.log(`wrote ${out}`);

// --- synthetic per-layer GeoJSON exports (maps lane R11) -------------------
// Coordinates are lon/lat under the projection block above, so [lon,lat] maps to
// pixel (lon, 300-lat) and OW point (lon, lat). Kept tiny + self-contained.
const geojsonDir = join(here, "geojson");
mkdirSync(geojsonDir, { recursive: true });

// One zone polygon (~6 points) with a hatch color (→ flat-fallback in code) and
// a Rebels type (non-Invasion → cyan fallback).
const zones = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: 0, name: "The Riven Coast", type: "Rebels", color: "url(#hatch3)", cells: [1, 2, 3] },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [10, 10],
            [60, 12],
            [90, 50],
            [70, 90],
            [20, 80],
            [8, 40],
            [10, 10],
          ],
        ],
      },
    },
  ],
};

// One river LineString whose properties.id === pack river .i (3) so the Zone
// links to the river Location via x_azgaar_location_ref (R6).
const rivers = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: 3, name: "Saltrun", type: "River" },
      geometry: {
        type: "LineString",
        coordinates: [
          [100, 100],
          [140, 130],
          [180, 150],
          [220, 200],
        ],
      },
    },
  ],
};

// One road (group roads → default ON) and one trail (default OFF).
const routes = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { id: 0, group: "roads", name: "The Old Road" },
      geometry: {
        type: "LineString",
        coordinates: [
          [30, 30],
          [80, 60],
          [130, 70],
        ],
      },
    },
    {
      type: "Feature",
      properties: { id: 1, group: "trails", name: "Hunters' Trail" },
      geometry: {
        type: "LineString",
        coordinates: [
          [200, 40],
          [230, 70],
        ],
      },
    },
  ],
};

for (const [label, data] of [
  ["Thornevale Zones.geojson", zones],
  ["Thornevale Rivers.geojson", rivers],
  ["Thornevale Routes.geojson", routes],
]) {
  const p = join(geojsonDir, label);
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n");
  console.log(`wrote ${p}`);
}
