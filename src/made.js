/**
 * The names this converter makes: an element name that is not one string of the export taken as written.
 *
 * Two kinds of source, as the onlyworlds import doors count them. A `joined` name is the export's own words with
 * ours between them: a diplomacy tie becomes a Relation named `<state>–<state>: Alliance`. An `ours` name is one
 * for a thing the export never names: a river with no name becomes `River <n>`.
 *
 * Each item the converter makes carries the kind of its made name beside the element (`{ type, element, made }`),
 * never in it: no field on an element says its name was made, and nothing written to a folder or a bulk payload
 * holds `made`. The command counts the kinds and prints one line a kind. A reader such as a gate tells a made name
 * by its type and its whole name matched by the kind's `regex`; a name that is the export's text and fits a
 * pattern too (a burg its author named `Burg 3`) cannot be told apart by its name: the converter counts what it
 * made, and a reader of names alone counts both.
 */

/**
 * One kind: `kind` its stable id, `type` the element type it names, `pattern` its human form (angle brackets
 * around the export's words), `source` `joined` or `ours`, `regex` a whole name of the kind, as a string both
 * JavaScript and Python read (`^(?:…)$` in JavaScript, `re.fullmatch` in Python), as the SDK's doors keep it.
 */
export const MADE_NAMES = [
  { kind: "import-record", type: "construct", pattern: "<map> (Azgaar import)", source: "joined", regex: ".+ \\(Azgaar import\\)" },
  { kind: "import-record-unnamed", type: "construct", pattern: "Azgaar Map (Azgaar import)", source: "ours", regex: "Azgaar Map \\(Azgaar import\\)" },
  { kind: "diplomacy", type: "relation", pattern: "<state>–<state>: Alliance|Enmity|Rivalry|Vassalage", source: "joined", regex: ".+–.+: (Alliance|Enmity|Rivalry|Vassalage)" },
  { kind: "river-typed", type: "location", pattern: "<river> <type>", source: "joined", regex: ".+ .+" },
  { kind: "river-unnamed", type: "location", pattern: "River <n>", source: "ours", regex: "River \\d+" },
  { kind: "state-unnamed", type: "institution", pattern: "State <n>", source: "ours", regex: "State \\d+" },
  { kind: "province-unnamed", type: "location", pattern: "Province <n>", source: "ours", regex: "Province \\d+" },
  { kind: "burg-unnamed", type: "location", pattern: "Burg <n>", source: "ours", regex: "Burg \\d+" },
  { kind: "culture-unnamed", type: "collective", pattern: "Culture <n>", source: "ours", regex: "Culture \\d+" },
  { kind: "religion-unnamed", type: "institution", pattern: "Religion <n>", source: "ours", regex: "Religion \\d+" },
  { kind: "marker-unnamed", type: "location", pattern: "Marker <n>", source: "ours", regex: "Marker \\d+" },
  { kind: "map", type: "map", pattern: "Map of <map>", source: "joined", regex: "Map of .+" },
  { kind: "map-unnamed", type: "map", pattern: "Map of Azgaar Map", source: "ours", regex: "Map of Azgaar Map" },
  { kind: "pin-burg-unnamed", type: "pin", pattern: "Burg <n>", source: "ours", regex: "Burg \\d+" },
  { kind: "pin-marker-unnamed", type: "pin", pattern: "Marker <n>", source: "ours", regex: "Marker \\d+" },
  { kind: "zone-unnamed", type: "zone", pattern: "Zone <n>", source: "ours", regex: "Zone .+" },
  { kind: "river-zone-typed", type: "zone", pattern: "<river> <type>", source: "joined", regex: ".+ .+" },
  { kind: "river-zone-unnamed", type: "zone", pattern: "River <n>", source: "ours", regex: "River .+" },
  { kind: "route-unnamed", type: "zone", pattern: "Road|Trail|Sea Route|Route <n>", source: "ours", regex: "(Road|Trail|Sea Route|Route) .+" },
];

/** True when an element of type `type` named `name` has a name of kind `m`'s shape. */
export const fits = (m, type, name) => m.type === type && new RegExp(`^(?:${m.regex})$`, "u").test(name);

const SAID = {
  joined: "joined: the export's words, ours between them",
  ours: "ours: the export gives it no name",
};

/** The kinds counted over `items`, in the declared order, a kind with none left out. A kind no entry declares
 * throws: the declaration and the converter disagree. */
export function madeCounts(items) {
  const declared = new Set(MADE_NAMES.map((m) => m.kind));
  const tally = new Map();
  for (const item of items) {
    if (item.made == null) continue;
    if (!declared.has(item.made)) throw new Error(`a made name of kind '${item.made}', which MADE_NAMES does not declare`);
    tally.set(item.made, (tally.get(item.made) ?? 0) + 1);
  }
  const counts = {};
  for (const m of MADE_NAMES) if (tally.has(m.kind)) counts[m.kind] = tally.get(m.kind);
  return counts;
}

/** The report's lines: a heading with the total, then one line a kind with a count; none when nothing was made. */
export function madeLines(counts) {
  const kinds = Object.keys(counts);
  if (!kinds.length) return [];
  const total = kinds.reduce((s, k) => s + counts[k], 0);
  const byKind = new Map(MADE_NAMES.map((m) => [m.kind, m]));
  const lines = [`Names made by the import, not taken whole from the export (${total}), one line a kind:`];
  for (const k of kinds) {
    const m = byKind.get(k);
    lines.push(`  - ${m.kind}, ${m.type} '${m.pattern}': ${counts[k]} (${SAID[m.source]})`);
  }
  return lines;
}
