#!/usr/bin/env node
/**
 * azgaar-to-world — convert an Azgaar Fantasy Map Generator JSON export (.map
 * saved as JSON, or the Full/Minimal .json export) into an OnlyWorlds world
 * folder and/or a POST /api/v2/bulk payload.
 *
 * Usage:
 *   node src/cli.js <export.json> --out <world-folder-dir>
 *                   [--bulk <payload.json>] [--world-name <name>] [--help]
 *
 * Output modes (either or both):
 *   --out    write an OnlyWorlds Folder Format world folder (open it in Atlas)
 *   --bulk   write a POST /api/v2/bulk payload ({ items: [{type, element}] })
 *            — push it with your own world key: the converter never talks to
 *            the network and never needs an account.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { mapAzgaar } from "./map.js";
import { writeWorldFolder } from "./folder.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--bulk") args.bulk = argv[++i];
    else if (a === "--world-name") args.worldName = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args._.length !== 1 || (!args.out && !args.bulk)) {
  console.log(
    "Usage: node src/cli.js <export.json> --out <dir> [--bulk <payload.json>] [--world-name <name>]",
  );
  process.exit(args.help ? 0 : 1);
}

const map = JSON.parse(readFileSync(args._[0], "utf8"));
const items = mapAzgaar(map);
const worldName = args.worldName || map.info?.mapName || "Azgaar Import";

console.log(`map: ${map.info?.mapName ?? "(unnamed)"} (FMG ${map.info?.version ?? "?"})`);
const byType = {};
for (const { type } of items) byType[type] = (byType[type] ?? 0) + 1;
console.log(`elements: ${items.length} —`, JSON.stringify(byType));

if (args.out) {
  const written = writeWorldFolder(args.out, worldName, items);
  console.log(`world folder: ${args.out} (${written.length} files)`);
}
if (args.bulk) {
  writeFileSync(args.bulk, JSON.stringify({ items }, null, 2) + "\n");
  console.log(`bulk payload: ${args.bulk} (POST /api/v2/bulk with your world key)`);
}
