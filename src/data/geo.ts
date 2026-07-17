/**
 * geo.ts — the ONE shared coordinate transform for the map (M4).
 *
 * Everything spatial — the baked OSM basemap, every hand-traced room polygon,
 * and (later, M6) the live GPS dot — is projected through THIS function, about
 * THIS origin. That is the whole trick behind "lat/lng → position is exact":
 * the SVG coordinate space literally *is* metres on a local tangent plane, so a
 * building footprint drawn from OSM and a GPS fix land in the same place by
 * construction. If two things used different projections they would drift apart;
 * routing every consumer through one pure function makes that impossible.
 *
 * Projection: equirectangular (local tangent plane) about `CON_ORIGIN`. Over the
 * ~250 m con footprint the error vs. a true geodesic is < 0.1 m, and — more
 * importantly — it is *self-consistent*: the same (lat,lon) always maps to the
 * same (x,y), which is all the map needs.
 *
 * Units & axes: metres. `x` is +east, `y` is +south (screen-down), so the result
 * drops straight into an SVG `viewBox` / `<path>` with no per-consumer y-flip.
 * (True north is −y.)
 *
 * Pure, no I/O — hammered directly by geo.test.ts, same as expand.ts.
 */

/** A geographic point: WGS84 latitude/longitude in degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A projected point in metres. x = east, y = south (SVG-down). */
export interface Point {
  x: number;
  y: number;
}

/**
 * Shared projection origin: the midpoint of the two hotel centroids on Gateway
 * Blvd (Wyndham 53.482617,-113.493799 · Delta 53.481620,-113.493650), so the con
 * footprint straddles (0,0) and metre values stay small and signed. Frozen
 * because it is a fixed datum — changing it silently reprojects every polygon.
 */
export const CON_ORIGIN: Readonly<LatLon> = Object.freeze({
  lat: 53.4821185,
  lon: -113.4937245,
});

// Metres per degree at the origin latitude. Meridian length is nearly constant;
// the parallel shrinks by cos(lat). Constants are the standard WGS84 series
// evaluated once at CON_ORIGIN.lat — good to millimetres over this area.
const DEG = Math.PI / 180;
const LAT0 = CON_ORIGIN.lat * DEG;
const M_PER_DEG_LAT =
  111132.92 - 559.82 * Math.cos(2 * LAT0) + 1.175 * Math.cos(4 * LAT0);
const M_PER_DEG_LON =
  111412.84 * Math.cos(LAT0) - 93.5 * Math.cos(3 * LAT0) + 0.118 * Math.cos(5 * LAT0);

/** Project a lat/lon to metres (x=east, y=south) about `origin`. */
export function project(p: LatLon, origin: LatLon = CON_ORIGIN): Point {
  return {
    x: (p.lon - origin.lon) * M_PER_DEG_LON,
    y: -(p.lat - origin.lat) * M_PER_DEG_LAT, // north is up in the world, down in SVG
  };
}

/** Inverse of {@link project}: metres back to lat/lon about `origin`. */
export function unproject(pt: Point, origin: LatLon = CON_ORIGIN): LatLon {
  return {
    lat: origin.lat + -pt.y / M_PER_DEG_LAT,
    lon: origin.lon + pt.x / M_PER_DEG_LON,
  };
}

/** Project a ring/line of lat/lon vertices to metre points (order preserved). */
export function projectRing(ring: LatLon[], origin: LatLon = CON_ORIGIN): Point[] {
  return ring.map((p) => project(p, origin));
}

/** Axis-aligned bounds of a set of points, or null if empty. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(points: Point[]): Bounds | null {
  if (points.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { x, y } of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}
