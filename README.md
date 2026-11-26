# azgaar-converter

Converts an [Azgaar Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) JSON export into an OnlyWorlds world folder, or into a payload for the OnlyWorlds bulk API.

States, provinces, burgs, cultures, religions, rivers and markers become typed, linked elements. With the map's GeoJSON layers it also carries the map itself: a Map with pins, zones and routes. Runs locally with Node.js, no dependencies, no account.

## Install

```
git clone https://github.com/OnlyWorlds/azgaar-converter
cd azgaar-converter
```

Needs Node.js 18 or later. There is nothing to `npm install`.

## Use

In Azgaar, export the map as JSON (the Full or the Minimal export). Then:

```
node src/cli.js my-map.json --out ./my-world
```

`./my-world` is an OnlyWorlds folder: open it in [Atlas](https://atlas.onlyworlds.com), or read it into Obsidian with the [OnlyWorlds Builder](https://github.com/OnlyWorlds/obsidian-plugin) plugin's **Import OnlyWorlds folder**. Each run mints new ids, so convert into an empty folder.

To carry the map as well, export Azgaar's GeoJSON layers into one folder and pass it, with the map image as the backdrop:

```
node src/cli.js my-map.json --out ./my-world --geojson-dir ./exports --map-image ./exports/my-map.svg
```

| Option | What it does |
|---|---|
| `--out <dir>` | Write an OnlyWorlds world folder. |
| `--bulk <file>` | Write a payload for `POST /api/v2/bulk` (either `--out` or `--bulk` is required; both work together). |
| `--world-name <name>` | World name. Default: the map's name. |
| `--geojson-dir <dir>` | A folder of Azgaar's per-layer GeoJSON exports; files are found by `Zones`, `Rivers` and `Routes` in their names. Adds the Map, Pins, Zones and Markers. |
| `--map-image <file>` | Backdrop image (svg, png or jpg), copied into the world folder and linked to the Map. Without it, pins are still written, but Atlas needs an image to place new ones. |
| `--full-geometry` | Also write trails and sea routes (roads only by default). |
| `--heraldry` | Set each state's `image_url` to a coat-of-arms image on Azgaar's hosted Armoria service. The converter makes no request: the images stay remote and load when a tool shows them. |

## What it makes

| Azgaar | OnlyWorlds |
|---|---|
| state | **Institution**: `supertype` the government form (Monarchy…), `subtype` the form name (Kingdom…) |
| diplomacy | **Relation** for Ally, Enemy, Rival and Vassal/Suzerain (one Vassalage per pair). Ally also fills both Institutions' `allies`; Enemy and Rival fill `adversaries` |
| campaign | **Event** with `supertype` War, linked to its states |
| province | **Location**, `supertype` Administrative Region, `primary_power` its state |
| burg | **Location**, `supertype` Settlement, `subtype` Capital, Port, City, Town or Village; linked to its state and culture |
| culture | **Collective**, `supertype` Culture; its ancestry (Elfish, Dwarven…), where the export gives one, in the description and `x_azgaar_ancestry` |
| religion | **Institution**, `supertype` Religion; the deity in the description and `x_azgaar_deity` |
| river | **Location**, `supertype` Waterway |
| marker with a note | **Location**, `supertype` Landmark; the note as plain-text description |
| the map | one **Construct** recording the import (seed, Azgaar version) |

Burg tiers use the displayed population (`population × populationRate × urbanization`): City from 20,000, Town from 5,000, Village below. Capital and Port come first.

Every element carries `x_azgaar_id` and `x_azgaar_type`. Data with no OnlyWorlds field (coordinates, raw population, coat-of-arms specs) is kept in `x_azgaar_*` fields.

With `--geojson-dir`: a **Map** sized to the image, a **Pin** per burg and per marker linked to its Location, and a **Zone** with an ordered chain of **Markers** for each Azgaar zone, river and road. Lines are simplified (the CLI prints how many points it dropped); a zone made of several polygons keeps its largest.

## Names made by the import

Each run also counts the names it made, one line a kind, beside the elements and never in them: an element name that is not one string of your export taken as written. Most are joined, your words with ours between them: a Relation `<state>–<state>: Alliance`, a river's Location `<river> <type>`, the import's Construct `<map> (Azgaar import)`. A few are ours, for a thing your export leaves unnamed (`River <n>`, `Burg <n>`). Every kind is declared in `src/made.js`.

## Not converted

Each run prints what it left behind in your export: every part it never reads, with its size (`not converted: pack.goods (71), pack.deals (6894), …`), and the entries it passed over (removed ones, markers with no note, notes that belong to no marker). The list below says why, and names the fields of a converted entry that are not carried.

- State and province territories (Azgaar exports them only per cell), and everything else it keeps per cell, a cell's `prosperity` and `development` among them: the converter makes no element for a cell.
- Province parents for burgs other than a province's capital.
- The economy layer. No OnlyWorlds field holds it, and the converter keeps none of it as raw data:
  - goods, markets and deals, a deal's `tariff` with them;
  - a state's finances, which a newer export keeps under `economy` (tax rates, tariffs, budget, treasury);
  - a burg's `treasury`, `production`, `pollTaxPaid` and `adjustments`;
  - a culture's `development`.
- Name bases.
- Deities stay text. To turn them into Character elements, run a pass with the [OnlyWorlds toolkit](https://github.com/OnlyWorlds/toolkit).

## Azgaar versions

Azgaar's export has no schema and changes with the generator. The tests hold the converter to two shapes:

- an export of generator 1.158.0 (November 2026), kept as downloaded in `fixtures/real/`: no top-level `notes` list, a marker carries its own name and note, a state's finances sit under `economy`;
- the older shape, where a marker's name and note come from the top-level `notes` list (`fixtures/azgaar-export.json`, made by hand).

Both are read. If an export of yours loses something the tables above promise, please open an issue and say which generator version wrote it (the converter prints it).

## Push to onlyworlds.com

The converter has no network code. To put the world online, write a payload and post it yourself with a world key that can write (`ow_w_`) and your PIN, both from your [account page](https://www.onlyworlds.com/account/):

```
node src/cli.js my-map.json --bulk payload.json
curl -X POST https://www.onlyworlds.com/api/v2/bulk \
  -H "API-Key: ow_w_..." -H "API-Pin: ...." \
  -H "Content-Type: application/json" -d @payload.json
```

The endpoint takes up to 1,000 items per request; a large map needs its payload split. The [API docs](https://www.onlyworlds.com/api/docs) describe it.

## Development

```
npm run fixtures   # regenerate the synthetic test map and GeoJSON
npm test
```

## Links

- [Docs](https://onlyworlds.github.io) · [The OnlyWorlds schema](https://github.com/OnlyWorlds/OnlyWorlds)
- [Discord](https://discord.gg/twCjqvVBwb) · [Issues](https://github.com/OnlyWorlds/azgaar-converter/issues)

## Licence

MIT. Azgaar's Fantasy Map Generator is also MIT-licensed; this tool reads its export format and includes none of its code. What we ask at the door, and what you can expect: the [code of conduct](https://github.com/OnlyWorlds/OnlyWorlds/blob/main/CODE_OF_CONDUCT.md).
