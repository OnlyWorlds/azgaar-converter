# azgaar-to-world

Convert an **[Azgaar Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/)** JSON export into an **OnlyWorlds world**: a typed constellation of states, provinces, burgs, cultures, religions, rivers and landmarks instead of one flat map file. Your generated map already *is* a world — this gives it OnlyWorlds bones you can open in Atlas, sync to Obsidian, or query over the API.

| Azgaar | OnlyWorlds |
|---|---|
| state | **Institution** — `supertype` = government form (Monarchy…), `subtype` = form name (Kingdom…); capital + stats in description |
| state diplomacy | **Relation** — strong ties only (Ally/Enemy/Rival, Vassal+Suzerain → one Vassalage), pairs deduped, both states linked |
| state campaigns | **Event** — named wars (`supertype` "War"), belligerent states linked |
| province | **Location** — `supertype` "Administrative Region"; controlling state via `primary_power` |
| burg | **Location** — `supertype` "Settlement"; `subtype` Capital / Port / City / Town / Village; parented to its province; scaled population + x/y kept |
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
```

- **Input**: an Azgaar FMG **JSON export** — the Full or Minimal `.json` export (top level `{info, settings, pack, notes, …}`). The default world name is `info.mapName`.
- **Local-only, zero dependencies, no account, no network.** You bring your own map; pushing to onlyworlds.com is optional and uses your own world key.
- The folder output follows the OnlyWorlds Folder Format (identity in each file's `id`, filenames presentation-only, bare link names, `x_*` extensions preserved).

## Promote the import (optional)

The mapping is deliberately mechanical. Two promotions want a judgment pass, kept out of the converter on purpose — run the [OnlyWorlds toolkit](https://github.com/OnlyWorlds/toolkit) over the folder:

- **Religion deities → Characters.** Each religion keeps its deity as text + `x_azgaar_deity`. A classify pass can mint a Character per deity and link it, turning "Maren of the Deep" from a string into a real element.
- **Burgs/rivers → a Map + Pins.** Every burg and marker keeps `x_azgaar_x`/`x_azgaar_y`. A future lane can build a Map element and drop Pins at those coordinates. Not built here.

## Status — honest flags

- **Built docs-derived from the FMG export shape and the [FMG wiki](https://github.com/Azgaar/Fantasy-Map-Generator/wiki).** The synthetic fixture covers every ruling (sentinels, removed entities, non-boolean port, diplomacy dedup, marker/note pairing, diacritics), but the converter has **NOT yet been run against a real exported map** — treat the first real export as a test.
- **Things I had to infer about the format** (verify against a real export, adjust if wrong):
  - `settings.populationRate` and `settings.urbanization` are the scale factors, and stored `burg.population` is in thousands-ish display units. If your numbers look off, trust `x_azgaar_population_raw`.
  - Campaign belligerents are read from `campaign.rival` (opposing state id); `start`/`end` are years, not links. Campaigns without a `name` are skipped.
  - A burg's province is derived from `province.burg` (the province's capital). Non-capital burgs get no province parent, because the burg→province edge lives in the unparsed cell data.
  - Marker↔note pairing assumes `note.id === "marker" + marker.i`. Only markers with a matching note become elements.
- **Not yet mapped** (README-flagged, `x_azgaar_*` candidates or future lanes):
  - `pack.cells` / `grid` — the raw cell mesh; would drive a real Map + Zone geography lane.
  - `routes` — roads/trails; would become Constructs or Location `infrastructure`.
  - `zones` — event/hazard overlays; would map to OW **Zone** elements.
  - `goods` / `markets` / `deals` (newer FMG economy layers) — would enrich Location production/commerce fields.
  - `nameBases` — the name-generator seed lists; reference data, not world content.
  - Rivers carry no basin/parent linking here; markers carry no Map/Pin geometry yet.

## Dev

```
npm run fixtures   # synthetic Azgaar export (original SFW content, doc-exact shapes)
npm test           # node --test, 11 tests incl. CLI end-to-end
```

MIT-licensed. Azgaar's Fantasy Map Generator is itself MIT-licensed; this tool reads its export format and ships none of its code.
