/**
 * geometry.ts — join the three static data files into render-ready metre shapes.
 *
 *   basemap.json    (generated)  outdoor OSM features, already in metres
 *   buildings.json  (authored)   per-building floor metadata + OSM way id
 *   rooms.json      (authored)   room rects in building-normalized [U,V]
 *
 * The footprint geometry lives ONLY in basemap.json; buildings.json joins to it
 * by id. Room rects are affine-fit into their building's footprint bbox here, so
 * everything downstream is plain metres and the SVG layer never touches lat/lon.
 * Pure — no Preact, no DOM — so it can be unit-tested directly.
 */

import basemapJson from '../../data/basemap.json';
import buildingsJson from '../../data/buildings.json';
import roomsJson from '../../data/rooms.json';
import { bounds, type Point, type Bounds } from '../../data/geo';

export type FeatureKind = 'hotel' | 'building' | 'road' | 'path' | 'parking' | 'rail' | 'water';

export interface BasemapFeature {
  kind: FeatureKind;
  id?: string;
  name?: string;
  closed: boolean;
  points: Point[];
}

export type PoiCategory = 'restaurant' | 'cafe' | 'fast_food' | 'bar' | 'shop' | 'service';

export interface Poi {
  name: string;
  category: PoiCategory;
  point: Point;
}

interface BasemapFile {
  generatedAt: string;
  origin: { lat: number; lon: number };
  source: string;
  license: string;
  features: BasemapFeature[];
  pois: Poi[];
}

/** One label per uniquely-named road, at that road's midpoint vertex. */
export interface StreetLabel {
  name: string;
  point: Point;
  /** Orientation of the road at the label, radians, for along-road text. */
  angle: number;
}

export interface Floor {
  id: string;
  label: string;
  underground: boolean;
  anchor: 'osm' | 'control-points';
}

interface BuildingMeta {
  id: string;
  name: string;
  osmWay: number;
  floors: Floor[];
}

interface BuildingsFile {
  buildings: BuildingMeta[];
}

export type RoomKind =
  | 'panel'
  | 'amenity'
  | 'desk'
  | 'entrance'
  | 'washroom'
  | 'elevator'
  | 'stairs'
  | 'structure'; // hatched, inaccessible back-of-house / structural block

type UV = [number, number];

interface RoomDef {
  name: string;
  aka: string | null;
  kind: RoomKind;
  schedule: string | null;
  /** Axis-aligned shorthand: [u0,v0,u1,v1]. Sugar for a 4-vertex `poly`. */
  rect?: [number, number, number, number];
  /** Arbitrary (concave/convex) outline, [U,V] vertices, clockwise. */
  poly?: UV[];
  /** Outline edge indices to OMIT from the wall stroke — i.e. door openings.
   *  Edge i runs from vertex i to vertex i+1 (wrapping). */
  doors?: number[];
}

interface FloorRooms {
  building: string;
  floor: string;
  placement: string;
  /** Inset factor: shrink the fit inside the footprint so rooms sit within the
   *  outer wall (the OSM footprint is the outer wall; rooms are inside it). */
  scale?: number;
  rooms: RoomDef[];
  /** Interior wall lines not owned by a single room outline (structural cores,
   *  corridor partitions), as [U,V] polylines. */
  walls?: UV[][];
}

interface RoomsFile {
  provisional: boolean;
  offMap: string[];
  locationUnknown: string[];
  floors: FloorRooms[];
}

// JSON imports infer widened types (string, number[]); cast through unknown to
// our precise unions/tuples. The data is validated by the build script + tests.
export const basemap = basemapJson as unknown as BasemapFile;
const buildingsData = buildingsJson as unknown as BuildingsFile;
const roomsData = roomsJson as unknown as RoomsFile;

/** A building with its footprint geometry resolved from the basemap. */
export interface BuildingGeom {
  id: string;
  name: string;
  footprint: Point[];
  bounds: Bounds;
  floors: Floor[];
}

/** One drawn room, in metres. `polygon` is the fill; `outline` is the wall runs
 *  to stroke (door openings already removed → gaps in the outline). */
export interface RoomShape {
  name: string;
  aka: string | null;
  kind: RoomKind;
  schedule: string | null;
  polygon: Point[];
  outline: Point[][];
  centroid: Point;
}

export const pois: Poi[] = basemap.pois;

const footprintById = new Map<string, BasemapFeature>();
for (const f of basemap.features) if (f.kind === 'hotel' && f.id) footprintById.set(f.id, f);

/**
 * One label per uniquely-named road. A road can be split into many OSM ways; we
 * pick the longest way for each name (most stable place to sit a label) and put
 * the label at its midpoint, angled along that segment.
 */
export function streetLabels(): StreetLabel[] {
  const longest = new Map<string, BasemapFeature>();
  for (const f of basemap.features) {
    if (f.kind !== 'road' || !f.name || f.points.length < 2) continue;
    const prev = longest.get(f.name);
    if (!prev || span(f.points) > span(prev.points)) longest.set(f.name, f);
  }
  return [...longest.values()].map((f) => {
    const mid = Math.floor(f.points.length / 2);
    const a = f.points[Math.max(0, mid - 1)]!;
    const b = f.points[Math.min(f.points.length - 1, mid)]!;
    let angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (angle > Math.PI / 2) angle -= Math.PI; // keep text upright
    if (angle < -Math.PI / 2) angle += Math.PI;
    return { name: f.name!, point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, angle };
  });
}

function span(pts: Point[]): number {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** All buildings, footprint + bounds joined from the basemap. */
export function buildings(): BuildingGeom[] {
  return buildingsData.buildings.flatMap((b) => {
    const feat = footprintById.get(b.id);
    const bnds = feat ? bounds(feat.points) : null;
    if (!feat || !bnds) return []; // no footprint → cannot place; skip rather than guess
    return [{ id: b.id, name: b.name, footprint: feat.points, bounds: bnds, floors: b.floors }];
  });
}

export function getBuilding(id: string): BuildingGeom | undefined {
  return buildings().find((b) => b.id === id);
}

// ── oriented-box fit (rotation + scale — keeps every room a true rectangle) ───
//
// Rooms ARE rectangular; the building envelope being rotated (or, for Delta, a
// trapezoid) does not change that. So the transform must be a similarity/affine
// that maps axis-aligned plan rects to axis-aligned-in-a-rotated-frame world
// rects — i.e. rotation + per-axis scale + translation, NEVER a perspective
// keystone. We derive it from the building's own minimum-area enclosing rectangle
// (its true orientation), automatically, with no hand-picked control points.
// Because this is a linear map, plan rects that don't overlap stay non-overlapping
// and stay rectangular on the map.

interface OrientedBox {
  cx: number;
  cy: number;
  ux: Point; // unit axis for plan-U (west→east-ish)
  vy: Point; // unit axis for plan-V (north→south-ish)
  fullU: number;
  fullV: number;
}

/** Andrew's monotone-chain convex hull (no repeated closing point). */
function convexHull(pts: Point[]): Point[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (src: Point[]): Point[] => {
    const out: Point[] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return half(p).concat(half([...p].reverse()));
}

/** Minimum-area enclosing rectangle via rotating calipers over the hull edges. */
function orientedBox(points: Point[]): OrientedBox {
  const hull = convexHull(points);
  let best: OrientedBox | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of hull) {
      const rx = p.x * c - p.y * s;
      const ry = p.x * s + p.y * c;
      if (rx < minX) minX = rx;
      if (ry < minY) minY = ry;
      if (rx > maxX) maxX = rx;
      if (ry > maxY) maxY = ry;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w * h >= bestArea) continue;
    bestArea = w * h;
    const cxr = (minX + maxX) / 2;
    const cyr = (minY + maxY) / 2;
    const cw = Math.cos(ang);
    const sw = Math.sin(ang);
    best = {
      cx: cxr * cw - cyr * sw,
      cy: cxr * sw + cyr * cw,
      ux: { x: cw, y: sw },
      vy: { x: -sw, y: cw },
      fullU: w,
      fullV: h,
    };
  }
  const box = best!;
  // Assign the box's axes so plan-U is the more east-west one and both point the
  // conventional way (U → east, V → south), keeping the plan un-mirrored.
  let { ux, vy, fullU, fullV } = box;
  if (Math.abs(ux.x) < Math.abs(vy.x)) {
    [ux, vy] = [vy, ux];
    [fullU, fullV] = [fullV, fullU];
  }
  if (ux.x < 0) ux = { x: -ux.x, y: -ux.y };
  if (vy.y < 0) vy = { x: -vy.x, y: -vy.y };
  return { cx: box.cx, cy: box.cy, ux, vy, fullU, fullV };
}

const boxCache = new Map<string, OrientedBox>();
function buildingBox(b: BuildingGeom): OrientedBox {
  let box = boxCache.get(b.id);
  if (!box) {
    box = orientedBox(b.footprint);
    boxCache.set(b.id, box);
  }
  return box;
}

/** Place a plan point into the oriented box (rotation + per-axis scale + inset). */
function place(u: number, v: number, box: OrientedBox, scale: number): Point {
  const du = (u - 0.5) * box.fullU * scale;
  const dv = (v - 0.5) * box.fullV * scale;
  return {
    x: box.cx + du * box.ux.x + dv * box.vy.x,
    y: box.cy + du * box.ux.y + dv * box.vy.y,
  };
}

/** [U,V] vertices of a room: its `poly`, or its `rect` expanded to 4 corners. */
function roomVerts(r: RoomDef): UV[] {
  if (r.poly) return r.poly;
  const [u0, v0, u1, v1] = r.rect!;
  return [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
}

/** Split a closed vertex ring into wall runs, dropping the `doors` edges (gaps).
 *  Edge i connects vertex i → i+1 (wrapping); a run is a maximal door-free span. */
function outlineRuns(verts: Point[], doors: number[]): Point[][] {
  const skip = new Set(doors);
  const n = verts.length;
  const runs: Point[][] = [];
  let cur: Point[] = [];
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) {
      if (cur.length) runs.push(cur);
      cur = [];
      continue;
    }
    if (cur.length === 0) cur.push(verts[i]!);
    cur.push(verts[(i + 1) % n]!);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function centroid(poly: Point[]): Point {
  const n = poly.length || 1;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

/** Rooms for a building+floor, as metre polygons + door-aware wall runs. */
export function floorRooms(buildingId: string, floorId: string): RoomShape[] {
  const b = getBuilding(buildingId);
  if (!b) return [];
  const fr = roomsData.floors.find((f) => f.building === buildingId && f.floor === floorId);
  if (!fr) return [];
  const box = buildingBox(b);
  const scale = fr.scale ?? 1;
  return fr.rooms.map((r) => {
    const polygon = roomVerts(r).map(([u, v]) => place(u, v, box, scale));
    return {
      name: r.name,
      aka: r.aka,
      kind: r.kind,
      schedule: r.schedule,
      polygon,
      outline: outlineRuns(polygon, r.doors ?? []),
      centroid: centroid(polygon),
    };
  });
}

/** Interior wall polylines for a building+floor, in metres. */
export function interiorWalls(buildingId: string, floorId: string): Point[][] {
  const b = getBuilding(buildingId);
  if (!b) return [];
  const fr = roomsData.floors.find((f) => f.building === buildingId && f.floor === floorId);
  if (!fr?.walls) return [];
  const box = buildingBox(b);
  const scale = fr.scale ?? 1;
  return fr.walls.map((w) => w.map(([u, v]) => place(u, v, box, scale)));
}

/**
 * Lower-cased names of every room in a building (all floors). Used to hide an
 * outdoor POI that duplicates an in-building venue while that building's floor is
 * open — e.g. "Sushi Toshi" is both an OSM restaurant and a Wyndham room, and the
 * outdoor pin overlaps the drawn room.
 */
export function buildingRoomNames(buildingId: string): Set<string> {
  const s = new Set<string>();
  for (const fr of roomsData.floors) {
    if (fr.building !== buildingId) continue;
    for (const r of fr.rooms) s.add(r.name.toLowerCase());
  }
  return s;
}

/** Which building+floor a schedule room string maps to, if any is traced. */
export function locateScheduleRoom(scheduleRoom: string): { building: string; floor: string } | null {
  for (const fr of roomsData.floors) {
    if (fr.rooms.some((r) => r.schedule === scheduleRoom)) {
      return { building: fr.building, floor: fr.floor };
    }
  }
  return null;
}

export const roomsMeta = { provisional: roomsData.provisional, offMap: roomsData.offMap };
