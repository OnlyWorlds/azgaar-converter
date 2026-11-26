# Real exports

Files here are Azgaar's own exports, saved as downloaded and never edited. The tests read them to hold the converter to what the generator writes today; `../azgaar-export.json` beside this folder is made by hand (`../make_fixture.js`) in the shape of an older export.

| File | What it is |
|---|---|
| `raroia-minimal-fmg-1.158.0.json` | The Minimal JSON export (the Export pane, Export to JSON, Minimal) of a map generated at https://azgaar.github.io/Fantasy-Map-Generator/ on 2026-11-26, generator version 1.158.0, seed 572885916, culture set High Fantasy. 22 states with the neutral lands, 160 provinces, 560 burgs, 12 cultures, 14 religions, 154 rivers and 82 markers, each list counted with its reserved first entry where it has one. |

What this export showed that the older shape does not have:

- No top-level `notes` list. A marker carries its own `name` and `note`.
- Marker ids start at 0, and marker 0 is a marker like any other.
- A state's finances sit under `economy`; `pack` also holds `goods`, `markets` and `deals`, a deal as a row of nine numbers.
- A culture has an `ancestry` in the High Fantasy set, and a `development` number.
