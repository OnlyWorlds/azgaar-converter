/**
 * Geometry lane for the maps emission (R4–R7).
 *
 * Two coordinate systems meet here:
 *   - FMG's .map/JSON `pack` carries burg/marker x,y in IMAGE PIXEL space
 *     (0..info.width, 0..info.height, origin top-left). Pins ride these.
 *   - FMG's per-layer GeoJSON exports (Zones/Rivers/Routes) carry coordinates
 *     in GEOGRAPHIC lon/lat DEGREES. Zones + Marker chains ride these, so we
 *     project lon/lat back to image pixels via `mapCoordinates`, then invert y.
 *
 * OW origin is bottom-left; FMG is top-left. R3: y_ow = imageHeight - round(y_fmg).
 * All emitted coordinates are integers in native image-pixel space (R3, D2).
 *
 * Simplification: Douglas-Peucker (own implementation, zero deps — R1) at a base
 * tolerance, then a hard vertex cap per geometry class; if still over cap we raise
 * tolerance iteratively until under (R4). Drop stats are surfaced to the CLI.
 */

/**
 * Project an FMG-GeoJSON [lon, lat] to image-pixel {x, y_fmg} using the export's
 * mapCoordinates block. Verified exact against the fixture's marker pixel props.
 *   x_fmg  = (lon - lonW) / lonT * width
 *   y_fmg  = (latN - lat) / latT * height   (top-left origin)
 */
export function lonLatToPixel([lon, lat], mc, width, height) {
  const x = ((lon - mc.lonW) / mc.lonT) * width;
  const yFmg = ((mc.latN - lat) / mc.latT) * height;
  return { x, yFmg };
}

/** R3: image-pixel FMG point → OW integer pixel point (y inverted). */
export function toOwPoint(xFmg, yFmg, height) {
  return { x: Math.round(xFmg), y: height - Math.round(yFmg) };
}

/** Perpendicular distance from point p to the segment a–b (px space). */
function perpDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // projection parameter t of p onto the infinite line, clamped to the segment
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Douglas-Peucker line simplification (R1: ~30 lines, zero deps). Keeps the
 * endpoints and any vertex whose perpendicular distance exceeds `tolerance`.
 * Iterative stack (no recursion) so a pathological ring can't blow the stack.
 * Input/output: arrays of {x, y}.
 */
export function douglasPeucker(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], points[start], points[end]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tolerance && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx], [idx, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Simplify to a hard vertex cap (R4). Start at `tolerance`, run DP; while the
 * result exceeds `cap`, raise tolerance (×1.6) and retry. Rings (closed) keep
 * their closing behavior by treating first==last outside; here we operate on the
 * raw point list the caller passes and let the caller decide closure.
 * Returns { points, tolerance } — final tolerance recorded for stats.
 */
export function simplifyToCap(points, tolerance, cap) {
  let tol = tolerance;
  let simplified = douglasPeucker(points, tol);
  let guard = 0;
  while (simplified.length > cap && guard < 40) {
    tol *= 1.6;
    simplified = douglasPeucker(points, tol);
    guard++;
  }
  return { points: simplified, tolerance: tol };
}

/** Largest ring (by vertex count) of a Polygon/MultiPolygon coordinate array. */
export function largestRing(geometry) {
  if (geometry.type === "Polygon") {
    // rings[0] is the outer ring by GeoJSON spec
    return { ring: geometry.coordinates[0], ringCount: 1 };
  }
  if (geometry.type === "MultiPolygon") {
    let best = null;
    let bestLen = -1;
    for (const poly of geometry.coordinates) {
      const outer = poly[0];
      if (outer.length > bestLen) {
        bestLen = outer.length;
        best = outer;
      }
    }
    return { ring: best, ringCount: geometry.coordinates.length };
  }
  return { ring: null, ringCount: 0 };
}

/** Merge a MultiLineString into one ordered point list; pass LineString through. */
export function lineCoords(geometry) {
  if (geometry.type === "LineString") return geometry.coordinates;
  if (geometry.type === "MultiLineString") return geometry.coordinates.flat();
  return null;
}

/**
 * FMG zone `type` → flat fallback color when the source color is a hatch pattern
 * (`url(#hatch…)`), which Atlas can't render as a fill (R5/D4). Invasion-family
 * (hostile) zones get dark red; everything else a cyan. Non-hatch colors pass
 * through untouched.
 */
export function resolveZoneColor(fmgColor, fmgType) {
  if (typeof fmgColor === "string" && fmgColor.startsWith("url(")) {
    return fmgType === "Invasion" ? "#8b0000" : "#22d3ee";
  }
  return fmgColor || "#22d3ee";
}
