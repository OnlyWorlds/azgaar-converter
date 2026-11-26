/**
 * What an export held that a run did not convert, so the command can say it.
 *
 * Two lists, both read from the export itself and never from a fixed table of names:
 *   - every part of the export the converter never reads, by name and size;
 *   - the entries it passed over in the lists it does read (removed ones, markers with no note).
 *
 * Fields inside a converted entry (a state's `economy`, a burg's `treasury`) are not counted
 * here: the README's "Not converted" names those.
 */

/** The top-level parts and the `pack` lists the converter reads. Everything else is left. */
export const READ_TOP = ["info", "settings", "mapCoordinates", "pack", "notes"];
export const READ_PACK = ["cultures", "burgs", "states", "provinces", "religions", "rivers", "markers"];
/** The read lists whose first entry is Azgaar's reserved one (Wildlands, Neutrals…), never an element. */
const RESERVED_FIRST = ["cultures", "burgs", "states", "provinces", "religions"];

const isEmpty = (v) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const sizeOf = (v) => (Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : 1);

/**
 * @param map    the parsed export
 * @param items  what `mapAzgaar` made from it
 * @returns {{ unread: { part: string, size: number }[], removed: number, markersWithoutNote: number, otherNotes: number }}
 */
export function leftBehind(map, items) {
  const top = map && typeof map === "object" ? map : {};
  const pack = top.pack && typeof top.pack === "object" ? top.pack : {};

  const unread = [];
  for (const [k, v] of Object.entries(pack)) {
    if (!READ_PACK.includes(k) && !isEmpty(v)) unread.push({ part: `pack.${k}`, size: sizeOf(v) });
  }
  for (const [k, v] of Object.entries(top)) {
    if (!READ_TOP.includes(k) && !isEmpty(v)) unread.push({ part: k, size: sizeOf(v) });
  }

  let removed = 0;
  for (const k of READ_PACK) {
    const list = Array.isArray(pack[k]) ? pack[k] : [];
    removed += list.filter((e, i) => e && e.removed === true && !(i === 0 && RESERVED_FIRST.includes(k))).length;
  }
  const markers = Array.isArray(pack.markers) ? pack.markers.filter((m) => m && m.removed !== true) : [];
  // a marker's Location only: the map lane's Pins and chain Markers are not counted
  const made = items.filter((i) => i.type === "location" && i.element.x_azgaar_type === "marker").length;

  // an older export's notes list also holds notes of other things (a burg, a state) and
  // notes whose marker is gone: only a marker's note is read
  const markerIds = new Set(markers.map((m) => `marker${m.i}`));
  const notes = Array.isArray(top.notes) ? top.notes : [];
  const otherNotes = notes.filter((n) => !n || !markerIds.has(String(n.id))).length;

  return { unread, removed, markersWithoutNote: markers.length - made, otherNotes };
}

/** The lines the command prints for a report; the last one always, the others when they have something to say. */
export function leftBehindLines(report, opts = {}) {
  const lines = [];
  if (report.unread.length) {
    lines.push(`not converted: ${report.unread.map((u) => `${u.part} (${u.size})`).join(", ")}`);
    const drawn = report.unread.some((u) => u.part === "pack.zones" || u.part === "pack.routes");
    if (drawn && !opts.geojsonDir) {
      lines.push("  zones and routes are drawn only with --geojson-dir, from Azgaar's GeoJSON exports");
    }
  }
  if (report.removed || report.markersWithoutNote || report.otherNotes) {
    const s = (n) => (n === 1 ? "" : "s");
    lines.push(
      `passed over: ${report.removed} removed, ${report.markersWithoutNote} marker${s(report.markersWithoutNote)} with no note, ` +
        `${report.otherNotes} note${s(report.otherNotes)} of no marker`,
    );
  }
  lines.push('fields of a converted entry that are not carried: see the README, "Not converted"');
  return lines;
}
