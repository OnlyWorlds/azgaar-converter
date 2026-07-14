/**
 * Azgaar Fantasy Map Generator (FMG) → OnlyWorlds element mapping.
 *
 * FMG's .map / JSON export is one big object: { info, settings, pack, notes, ... }.
 * The world lives in `pack`: parallel arrays (cultures, burgs, states, provinces,
 * religions) plus keyed collections (rivers, markers), and a flat `notes` list.
 *
 * Index/sentinel mechanics (the correctness core):
 *   - cultures / burgs / states / provinces / religions: ARRAY INDEX == id, and
 *     element 0 is a SENTINEL (Wildlands / empty burg / Neutrals / no province /
 *     "No religion"). The sentinel never becomes an element, and any reference to
 *     id 0 means "unassigned" → we omit the link.
 *   - rivers / markers: unordered — key off `.i`, never array position.
 *   - anything with `removed: true` is filtered out.
 *   - burg.port is 0 (not a port) or a water-feature id (a port) — NOT a boolean.
 *   - markers pair with notes by id convention (note.id === "marker" + marker.i);
 *     only markers WITH a matching note become elements.
 *
 * Every element carries x_azgaar_id + x_azgaar_type provenance. Unmapped Azgaar
 * data rides x_azgaar_* extensions — nothing destroyed. Cross-references
 * (province→state, burg→province, diplomacy pairs) resolve WITHIN the batch to
 * the minted OW UUIDs.
 */

import { uuidv7 } from "./ids.js";

/** Very small HTML → text: tags out, entities decoded, whitespace collapsed. */
export function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Diplomacy statuses FMG stores in state.diplomacy[]. We only promote the
 * strong, directed-or-mutual ties into Relation elements; the rest are the
 * default neutral fabric and would drown the world in noise.
 */
const STRONG_DIPLOMACY = new Set(["Ally", "Enemy", "Rival", "Vassal", "Suzerain"]);

/** Burg subtype thresholds by real (scaled) population, in people. Documented in README. */
const CITY_MIN = 20000; // >= this → City
const TOWN_MIN = 5000; //  >= this → Town, below → Village

/** Scale FMG's stored burg population to a real headcount. */
function realPopulation(burg, settings) {
  const rate = Number(settings?.populationRate) || 0;
  const urbanization = Number(settings?.urbanization) || 0;
  const raw = Number(burg?.population) || 0;
  if (!rate || !urbanization) return null; // can't scale — caller keeps raw only
  return Math.round(raw * rate * urbanization);
}

/**
 * Convert a parsed FMG export object into [{ type, element }] pairs with
 * intra-batch links resolved. `opts.mintId` overridable for deterministic tests.
 */
export function mapAzgaar(map, opts = {}) {
  const mint = opts.mintId ?? uuidv7;
  const info = map.info ?? {};
  const settings = map.settings ?? {};
  const pack = map.pack ?? {};

  const cultures = pack.cultures ?? [];
  const burgs = pack.burgs ?? [];
  const states = pack.states ?? [];
  const provinces = pack.provinces ?? [];
  const religions = pack.religions ?? [];
  const rivers = pack.rivers ?? [];
  const markers = pack.markers ?? [];
  const notes = map.notes ?? [];

  // --- id registries. key "<kind>:<id>" -> minted uuid -----------------------
  const idOf = new Map();
  const key = (kind, id) => `${kind}:${id}`;
  const mintFor = (kind, id) => {
    const k = key(kind, id);
    if (!idOf.has(k)) idOf.set(k, mint());
    return idOf.get(k);
  };
  const ref = (kind, id) => {
    // id 0 in an indexed array is the sentinel == "unassigned"
    if (id === null || id === undefined || id === 0) return null;
    return idOf.get(key(kind, id)) ?? null;
  };

  const alive = (e) => e && e.removed !== true;
  // Indexed arrays: skip element 0 (sentinel) and any removed.
  const indexed = (arr) => arr.filter((e, i) => i !== 0 && alive(e));
  // Keyed collections: skip the .i === 0 slot FMG reserves, and removed.
  const keyed = (arr) => arr.filter((e) => e && e.i !== 0 && alive(e));

  const keptCultures = indexed(cultures);
  const keptBurgs = indexed(burgs);
  const keptStates = indexed(states);
  const keptProvinces = indexed(provinces);
  const keptReligions = indexed(religions);
  const keptRivers = keyed(rivers);
  // Notes keyed by their string id for marker pairing.
  const noteById = new Map(notes.map((n) => [String(n.id), n]));
  const keptMarkers = keyed(markers).filter((m) => noteById.has(`marker${m.i}`));

  // --- pass 1: mint ids so cross-references resolve --------------------------
  for (const c of keptCultures) mintFor("culture", c.i);
  for (const b of keptBurgs) mintFor("burg", b.i);
  for (const s of keptStates) mintFor("state", s.i);
  for (const p of keptProvinces) mintFor("province", p.i);
  for (const r of keptReligions) mintFor("religion", r.i);
  for (const r of keptRivers) mintFor("river", r.i);
  for (const m of keptMarkers) mintFor("marker", m.i);

  const out = [];
  const push = (type, element) => out.push({ type, element: strip(element) });

  // --- import-record Construct (one) ----------------------------------------
  const mapName = info.mapName || "Azgaar Map";
  push("construct", {
    id: mint(),
    name: `${mapName} (Azgaar import)`,
    description: [
      `Import record for the Azgaar Fantasy Map Generator export "${mapName}".`,
      info.seed ? `Seed: ${info.seed}.` : null,
      info.version ? `FMG version: ${info.version}.` : null,
      info.exportedAt ? `Exported: ${info.exportedAt}.` : null,
    ]
      .filter(Boolean)
      .join(" "),
    supertype: "Import",
    subtype: "Azgaar FMG",
    x_azgaar_type: "map",
    x_azgaar_seed: info.seed ?? null,
    x_azgaar_version: info.version ?? null,
  });

  // Pre-pass over diplomacy for the NATIVE Institution links (allies/adversaries).
  // Ally → allies on both sides; Enemy/Rival → adversaries on both sides.
  // Vassalage stays Relation-only (it's neither, and parent_institution would
  // over-claim governance). The Relation elements below carry the full story.
  const alliesOf = new Map();
  const adversariesOf = new Map();
  const addPair = (m, a, b) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a).add(b);
  };
  for (const s of keptStates) {
    const dip = s.diplomacy ?? [];
    for (let j = 0; j < dip.length; j++) {
      if (j === s.i || !keptStates.some((st) => st.i === j)) continue;
      if (dip[j] === "Ally") {
        addPair(alliesOf, s.i, j);
        addPair(alliesOf, j, s.i);
      } else if (dip[j] === "Enemy" || dip[j] === "Rival") {
        addPair(adversariesOf, s.i, j);
        addPair(adversariesOf, j, s.i);
      }
    }
  }
  const stateLinks = (m, i) =>
    [...(m.get(i) ?? [])].map((id) => ref("state", id)).filter(Boolean);

  // --- states → Institution -------------------------------------------------
  for (const s of keptStates) {
    const burgCount = keptBurgs.filter((b) => b.state === s.i).length;
    const statsBits = [
      s.area ? `area ${s.area}` : null,
      `${burgCount} burg${burgCount === 1 ? "" : "s"}`,
      s.rural || s.urban ? `population ${Math.round((s.rural || 0) + (s.urban || 0))}` : null,
    ].filter(Boolean);
    const desc = [s.fullName || s.name, statsBits.length ? `(${statsBits.join(", ")})` : null]
      .filter(Boolean)
      .join(" ");
    push("institution", {
      id: ref("state", s.i),
      name: s.name || `State ${s.i}`,
      description: desc,
      supertype: s.form || "",
      subtype: s.formName || "",
      allies: stateLinks(alliesOf, s.i),
      adversaries: stateLinks(adversariesOf, s.i),
      x_azgaar_id: s.i,
      x_azgaar_type: "state",
      x_azgaar_full_name: s.fullName ?? null,
      x_azgaar_capital_burg: s.capital || null,
      x_azgaar_culture: s.culture || null,
    });
  }

  // --- state diplomacy → Relation (dedup pairs, strong ties only) -----------
  const seenPairs = new Set();
  for (const s of keptStates) {
    const dip = s.diplomacy ?? [];
    // FMG stores diplomacy as an array indexed by state id: dip[j] is s's stance to state j.
    for (let j = 0; j < dip.length; j++) {
      const raw = dip[j];
      if (!STRONG_DIPLOMACY.has(raw)) continue;
      const other = keptStates.find((st) => st.i === j);
      if (!other || other.i === s.i) continue;
      const a = Math.min(s.i, j);
      const b = Math.max(s.i, j);
      // Vassal/Suzerain collapse to one directed "Vassalage" — order by lord.
      const isVassalage = raw === "Vassal" || raw === "Suzerain";
      const pairKey = `${a}:${b}:${isVassalage ? "vassalage" : raw.toLowerCase()}`;
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      const sa = keptStates.find((st) => st.i === a);
      const sb = keptStates.find((st) => st.i === b);
      let label;
      if (raw === "Ally") label = `${sa.name}–${sb.name}: Alliance`;
      else if (raw === "Enemy") label = `${sa.name}–${sb.name}: Enmity`;
      else if (raw === "Rival") label = `${sa.name}–${sb.name}: Rivalry`;
      else {
        // Vassalage: the state whose stance is "Suzerain" is the lord.
        const lord = raw === "Suzerain" ? s : other;
        const vassal = raw === "Suzerain" ? other : s;
        label = `${lord.name}–${vassal.name}: Vassalage`;
      }
      const links = [ref("state", a), ref("state", b)].filter(Boolean);
      push("relation", {
        id: mint(),
        name: label,
        institutions: links,
        x_azgaar_type: "diplomacy",
        x_azgaar_status: isVassalage ? "Vassalage" : raw,
      });
    }
  }

  // --- state campaigns → Event (only named wars; belligerents linked) -------
  for (const s of keptStates) {
    for (const c of s.campaigns ?? []) {
      if (!c || !c.name) continue; // murky/unnamed → skip (honest)
      // The one documented belligerent pointer on a campaign is `rival` (the
      // opposing state id). start/end are years, not links — never treat as such.
      const belligerents = [ref("state", s.i), ref("state", c.rival)].filter(Boolean);
      push("event", {
        id: mint(),
        name: c.name,
        description: `Campaign of ${s.name}.`,
        supertype: "War",
        start_date: Number.isFinite(c.start) ? c.start : null,
        end_date: Number.isFinite(c.end) ? c.end : null,
        institutions: belligerents,
        x_azgaar_type: "campaign",
        x_azgaar_state: s.i,
      });
    }
  }

  // --- provinces → Location -------------------------------------------------
  for (const p of keptProvinces) {
    const stateName = keptStates.find((s) => s.i === p.state)?.name;
    push("location", {
      id: ref("province", p.i),
      name: p.fullName || p.name || `Province ${p.i}`,
      description: stateName ? `Administrative region of ${stateName}.` : "",
      supertype: "Administrative Region",
      subtype: p.formName || "",
      primary_power: ref("state", p.state), // province's state == controlling Institution
      x_azgaar_id: p.i,
      x_azgaar_type: "province",
      x_azgaar_state: p.state || null,
      x_azgaar_burg: p.burg || null,
    });
  }

  // Which province owns a burg? FMG doesn't store burg.province directly; it's
  // derivable via province.burg (capital) or the cell, which we don't parse.
  // We link the capital burg → its province via province.burg. Others: none.
  const provinceOfBurg = new Map();
  for (const p of keptProvinces) {
    if (p.burg) provinceOfBurg.set(p.burg, p.i);
  }

  // --- burgs → Location -----------------------------------------------------
  for (const b of keptBurgs) {
    const isPort = (b.port ?? 0) !== 0; // port is 0 or a water-feature id, NOT boolean
    const isCapital = b.capital === 1 || b.capital === true;
    const pop = realPopulation(b, settings);
    let subtype;
    if (isCapital) subtype = "Capital";
    else if (isPort) subtype = "Port";
    else if (pop === null) subtype = "Settlement";
    else if (pop >= CITY_MIN) subtype = "City";
    else if (pop >= TOWN_MIN) subtype = "Town";
    else subtype = "Village";

    const stateName = keptStates.find((s) => s.i === b.state)?.name;
    const popPhrase =
      pop !== null ? `approx ${pop} people` : `population data unscaled (raw ${b.population ?? "?"})`;
    const desc = [
      stateName ? `${subtype} in ${stateName}.` : `${subtype}.`,
      popPhrase + ".",
    ].join(" ");

    const provId = provinceOfBurg.get(b.i);
    push("location", {
      id: ref("burg", b.i),
      name: b.name || `Burg ${b.i}`,
      description: desc,
      supertype: "Settlement",
      subtype,
      parent_location: provId ? ref("province", provId) : null,
      primary_power: ref("state", b.state),
      populations: ref("culture", b.culture) ? [ref("culture", b.culture)] : null,
      x_azgaar_id: b.i,
      x_azgaar_type: "burg",
      x_azgaar_state: b.state || null,
      x_azgaar_culture: b.culture || null,
      x_azgaar_port: isPort ? b.port : null,
      x_azgaar_population_raw: b.population ?? null,
      x_azgaar_x: b.x ?? null,
      x_azgaar_y: b.y ?? null,
    });
  }

  // --- cultures → Collective ------------------------------------------------
  for (const c of keptCultures) {
    push("collective", {
      id: ref("culture", c.i),
      name: c.name || `Culture ${c.i}`,
      description: "",
      supertype: "Culture",
      subtype: c.type || "",
      x_azgaar_id: c.i,
      x_azgaar_type: "culture",
    });
  }

  // --- religions → Institution ----------------------------------------------
  for (const r of keptReligions) {
    const descBits = [r.form ? `Form: ${r.form}.` : null, r.deity ? `Deity: ${r.deity}.` : null].filter(
      Boolean,
    );
    push("institution", {
      id: ref("religion", r.i),
      name: r.name || `Religion ${r.i}`,
      description: descBits.join(" "),
      supertype: "Religion",
      subtype: r.type || "",
      x_azgaar_id: r.i,
      x_azgaar_type: "religion",
      x_azgaar_deity: r.deity || null,
      x_azgaar_form: r.form || null,
      x_azgaar_culture: r.culture || null,
    });
  }

  // --- rivers → Location ----------------------------------------------------
  for (const r of keptRivers) {
    const descBits = [
      r.length ? `Length ${r.length}.` : null,
      r.discharge ? `Discharge ${r.discharge}.` : null,
    ].filter(Boolean);
    push("location", {
      id: ref("river", r.i),
      name: r.name ? `${r.name}${r.type ? ` ${r.type}` : ""}` : `River ${r.i}`,
      description: descBits.join(" "),
      supertype: "Waterway",
      subtype: r.type || "",
      x_azgaar_id: r.i,
      x_azgaar_type: "river",
      x_azgaar_length: r.length ?? null,
      x_azgaar_discharge: r.discharge ?? null,
    });
  }

  // --- markers (with note) → Location ---------------------------------------
  for (const m of keptMarkers) {
    const note = noteById.get(`marker${m.i}`);
    push("location", {
      id: ref("marker", m.i),
      name: (note && note.name) || m.type || `Marker ${m.i}`,
      description: htmlToText(note && note.legend),
      supertype: "Landmark",
      subtype: m.type || "Marker",
      x_azgaar_id: m.i,
      x_azgaar_type: "marker",
      x_azgaar_x: m.x ?? null,
      x_azgaar_y: m.y ?? null,
    });
  }

  return out;
}

function strip(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined || v === "") delete obj[k];
    else if (Array.isArray(v) && v.length === 0) delete obj[k];
  }
  return obj;
}
