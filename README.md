# azgaar-converter

Convert an **[Azgaar Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/)** JSON export into an **OnlyWorlds world**: a typed constellation of states, provinces, burgs, cultures, religions, rivers and landmarks instead of one flat map file. Your generated map already *is* a world — this gives it OnlyWorlds bones you can open in Atlas, sync to Obsidian, or query over the API.

> **New to OnlyWorlds?** It is an open standard for worldbuilding data: 22 typed element categories (Character, Location, Institution, Event, …) with defined fields and relationships, stored as plain files you own. One structure, readable by any tool. See [onlyworlds.com](https://www.onlyworlds.com), the [docs](https://onlyworlds.github.io), and the [schema](https://github.com/OnlyWorlds/OnlyWorlds). Open the result in [Atlas](https://atlas.onlyworlds.com) (the workspace), the [Obsidian plugin](https://github.com/OnlyWorlds/obsidian-plugin), or over the [API](https://www.onlyworlds.com/api/docs).
>
> **For AI assistants**: this emits an OnlyWorlds world folder (one JSON file per element, `id` = identity) — or a `/api/v2/bulk` payload. Types and fields are in the [schema repo](https://github.com/OnlyWorlds/OnlyWorlds) and the [LLM guide](https://onlyworlds.github.io/assets/ow_llm_guide.txt). To push a world yourself: mint a key at [onlyworlds.com/account](https://www.onlyworlds.com/account) (`ow_w_` writes) and POST the `--bulk` payload. The converter itself contains no network code.

| Azgaar | OnlyWorlds |
|---|---|
| state | **Institution** — `supertype` = government form (Monarchy…), `subtype` = form name (Kingdom…); capital + stats in description |
| state diplomacy | **Relation** — strong ties only (Ally/Enemy/Rival, Vassal+Suzerain → one Vassalage), pairs deduped, both states linked. Ally/Enemy/Rival ALSO fill the Institutions' native `allies`/`adversaries` links |
| state campaigns | **Event** — named wars (`supertype` "War"), belligerent states linked |
| province | **Location** — `supertype` "Administrative Region"; controlling state via `primary_power` |
| burg | **Location** — `supertype` "Settlement"; `subtype` Capital / Port / City / Town / Village; parented to its province; its culture linked via `populations`; scaled population + x/y kept |
| culture | **Collective** — `supertype` "Culture", `subtype` = culture type (Highland, Nomadic…) |
| religion | **Institution** — `supertype` "Religion", `subtype` = type (Folk, Organized…); deity in description + `x_azgaar_deity` |
| river | **Location** — `supertype` "Waterway"; length/discharge in description |
| marker + note | **Location** — `supertype` "Landmark"; note legend (HTML) → plain-text description |
| whole map | one **Construct** — import record (seed, FMG version, exportedAt) |

Every element carries `x_azgaar_id` + `x_azgaar_type` provenance. Anything Azgaar-specific with no OnlyWorlds home (coordinates, raw population, deity, port feature id, culture ids) rides `x_azgaar_*` extension fields — nothing is destroyed. Cross-references (province→state, burg→province, diplomacy pairs, war belligerents) resolve inside the batch to the minted OW UUIDs.

**Subtype thresholds** (burgs, on scaled population): City ≥ 20,000 · Town ≥ 5,000 · Village below. Capital and Port take precedence over the population tier. Population is scaled as `burg.population × settings.populationRate × settings.urbanization` (the FMG display formula); the raw stored value is always kept in `x_azgaar_population_raw`, and if the rate/urbanization settings are missing the description says so instead of guessing.

## Use

```
node src/cli.js my-map.json --out ./my-world           # OnlyWorlds folder — open it in Atlas
node src/cli.js my-map.json --bulk payload.json        # POST /api/v2/bulk payload for your own world
node src/cli.js my-map.json --out ./w --world-name "My Setting"
node src/cli.js my-map.json --out ./w --heraldry               # state Institutions get their coat-of-arms images (via Azgaar's armoria-api)

# The maps lane: carry the actual map (backdrop + pins + zones + rivers + roads)
node src/cli.js my-map.json --out ./w \
  --geojson-dir ./exports \                             # FMG's own per-layer GeoJSON exports
  --map-image ./exports/my-map.svg                      # backdrop image (svg/png/jpg)
  # add --provinces for province territories, --full-geometry for trails/searoutes
```

- **Input**: an Azgaar FMG **JSON export** — the Full or Minimal `.json` export (top level `{info, settings, pack, notes, …}`). The default world name is `info.mapName`.
- **Local-only, zero dependencies, no account, no network.** You bring your own map; pushing to onlyworlds.com is optional and uses your own world key.
- The folder output follows the OnlyWorlds Folder Format (identity in each file's `id`, filenames presentation-only, bare link names, `x_*` extensions preserved).

## Promote the import (optional)

The mapping is deliberately mechanical. Two promotions want a judgment pass, kept out of the converter on purpose — run the [OnlyWorlds toolkit](https://github.com/OnlyWorlds/toolkit) over the folder:

- **Religion deities → Characters.** Each religion keeps its deity as text + `x_azgaar_deity`. A classify pass can mint a Character per deity and link it, turning "Maren of the Deep" from a string into a real element.
- **Deities → Characters** stays a toolkit judgment pass; the burg/river geometry is now built in (see the maps lane below).

## The maps lane

With `--geojson-dir` (and optionally `--map-image`), the converter also carries the map itself:

- **Map** element (`width`/`height` = image pixels), with the backdrop image copied into the folder's local media store (`media/<mapId>/base-image/`) and linked via `image_media_id`.
- **Pin** per kept burg and FMG-marker, linked to that settlement's existing Location, placed in native image-pixel space (y inverted: OW origin is bottom-left, FMG top-left).
- **Zone** + ordered **Marker** chain for every FMG zone (polygon), every river and every roads-group route (lines). Rivers link back to their river-Location via `x_azgaar_location_ref`.
- Geometry comes from FMG's per-layer **GeoJSON exports** (lon/lat, projected to image pixels via `mapCoordinates`), never the cell mesh. Rings/lines are Douglas-Peucker-simplified to meaning-resolution (tolerance 2.5px, then hard caps: 40 verts/zone ring, 20/line) — the CLI prints dropped-vertex stats. Multi-polygon zones emit the largest ring and record `x_azgaar_rings`.
- Zone colors that are hatch patterns (`url(#hatch…)`) fall back to a flat color by type (dark red for Invasion-family, cyan otherwise).

## Status — honest flags

- **Real-export proven 2026-07-14**: run against a real FMG **v1.136.0** full export (12 states, 185 provinces, 773 burgs, 188 rivers, 68 markers) → 1,334 elements, all cross-links resolved. The first real run surfaced two format facts the docs didn't carry, both fixed and pinned in the test fixture:
  - Campaign belligerents are `attacker`/`defender` state ids on real exports (the wiki-documented `rival` never appeared; it's kept as a legacy fallback). `defender: 0` means a campaign against the neutral lands — one linked belligerent is correct there.
  - A war shared between two states is listed verbatim in **both** states' campaign arrays — the converter dedupes on name+years+belligerents and merges the owners, so it mints once with both Institutions linked. A missing `end` year means an ongoing war.
- **Mapper wire-proven 2026-07-14**: the fixture's 19-element bulk payload POSTed to a live OnlyWorlds world via `/api/v2/bulk` — 19/19 created with all cross-links resolved (`parent_location`, `primary_power`, `populations`, Relation/Event institution links) and `x_azgaar_*` extensions intact; then deleted, zero residue. The push used plain external `curl` with the emitted `--bulk` payload — the converter itself contains no network code, by design.
- **Things inferred from docs and confirmed on the real export**:
  - `settings.populationRate` and `settings.urbanization` are the scale factors, and stored `burg.population` is in thousands-ish display units (confirmed: a real capital at raw `19.876` × rate 1000 × urbanization 1.0 = 19,876 people). If your numbers look off, trust `x_azgaar_population_raw`.
  - A burg's province is derived from `province.burg` (the province's capital). Non-capital burgs get no province parent, because the burg→province edge lives in the unparsed cell data.
  - Marker↔note pairing assumes `note.id === "marker" + marker.i`. Only markers with a matching note become elements.
- **Maps lane proven 2026-07-14**: the same real v1.136.0 export with `--geojson-dir` + `--map-image` → a Map, 839 pins, 12 zones + 213 lines, 1,430 markers (Douglas-Peucker dropped 61% of raw vertices), backdrop SVG in the media store — folder written in ~1s. State/province **territory** polygons are not emitted (see below).
- **Not yet mapped** (README-flagged, `x_azgaar_*` candidates or future lanes):
  - **State/province territories** — FMG exports these only per-cell (`Cells` GeoJSON `properties.state`), not as dissolved polygons; tracing the outer boundary from the cell mesh is a follow-up, deliberately skipped here to avoid a hand-rolled mesh dissolve.
  - `goods` / `markets` / `deals` (the FMG economy layer, real since v1.124: typed goods, burg-centered markets with per-good stock and price, and a full buyer→seller trade ledger) — its own future trade-network lane, kept out of the maps lane on purpose.
  - `nameBases` — the name-generator seed lists; reference data, not world content.
  - There is no native `Zone.locations` link, so a river's line-Zone and its river-Location are joined by name + `x_azgaar_location_ref` — a schema-bench candidate.

## Dev

```
npm run fixtures   # synthetic Azgaar export + per-layer GeoJSON (original SFW content, doc-exact shapes)
npm test           # node --test, 24 tests incl. two CLI end-to-end runs
```

MIT-licensed. Azgaar's Fantasy Map Generator is itself MIT-licensed; this tool reads its export format and ships none of its code.
