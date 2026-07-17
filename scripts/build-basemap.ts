/**
 * build-basemap.ts — bake the outdoor OSM basemap to SVG-ready metres at BUILD
 * time (M4, bead fureh-schedules-aau.3). Run via `npm run basemap` (tsx).
 *
 * Why baked, not live tiles: the map must be pure vector (a raster tile can't
 * serve a near-max-magnification user) AND make zero runtime tile/CDN requests.
 * So we query Overpass once, project every vertex through the SAME transform the
 * rooms and the GPS dot use (src/data/geo.ts), and commit the result. The app
 * ships a static JSON of metre-space polylines — no network, no projection at
 * runtime, and dots land exactly on the streets by construction.
 *
 * Outputs:
 *   src/data/basemap.json      generated, SVG-ready features in metres (committed)
 *   scripts/basemap.osm.json   raw Overpass response (committed for ODbL + repro)
 *
 * ODbL: the data is © OpenStreetMap contributors, ODbL. The app surfaces that
 * credit on the Site view; keeping the query (below) + raw response in-repo makes
 * the derivation reproducible.
 */

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { project, CON_ORIGIN, type Point } from '../src/data/geo.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../src/data/basemap.json');
const RAW_OUT = resolve(__dirname, './basemap.osm.json');

// The two hotel building footprints, matched by OSM way id so we can tag them
// distinctly from the surrounding buildings. (Verified live via Overpass.)
const HOTELS: Record<number, { id: string; name: string }> = {
  321836536: { id: 'wyndham', name: 'Wyndham Edmonton Hotel and Conference Centre' },
  321840654: { id: 'delta', name: 'Delta Hotel by Marriott' },
};

// ~250 m bbox around CON_ORIGIN (0.00225° lat ≈ 250 m; lon widened by 1/cos lat).
const HALF_LAT = 0.00225;
const HALF_LON = HALF_LAT / Math.cos((CON_ORIGIN.lat * Math.PI) / 180);
const BBOX = {
  s: CON_ORIGIN.lat - HALF_LAT,
  w: CON_ORIGIN.lon - HALF_LON,
  n: CON_ORIGIN.lat + HALF_LAT,
  e: CON_ORIGIN.lon + HALF_LON,
};

const OVERPASS_URL = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

/** The exact query, kept in-repo for reproducibility (ODbL derivation). */
function overpassQuery(): string {
  const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
  // Two blocks: linear/area features (out geom) and POIs (out center — a node
  // for both nodes and ways, so a restaurant mapped as a building still lands).
  return `[out:json][timeout:60];
(
  way["building"](${bb});
  way["highway"](${bb});
  way["amenity"="parking"](${bb});
  way["railway"](${bb});
  way["waterway"](${bb});
);
out geom;
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|bank|pharmacy|fuel)$"](${bb});
  nwr["shop"](${bb});
);
out center;`;
}

// ── Overpass response shape (only the fields we read) ────────────────────────

interface OverpassNode {
  lat: number;
  lon: number;
}
interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassNode[];
  /** present on nodes */
  lat?: number;
  lon?: number;
  /** present on ways/relations with `out center` */
  center?: OverpassNode;
}
interface OverpassResponse {
  elements: OverpassElement[];
}

/** One baked, projected feature ready to become an SVG <path>. */
interface Feature {
  /** Coarse render class, so the app can style without re-reading OSM tags. */
  kind: 'hotel' | 'building' | 'road' | 'path' | 'parking' | 'rail' | 'water';
  /** Stable id for the two hotels (join target for buildings.json); else absent. */
  id?: string;
  name?: string;
  /** True if the vertex list is a closed ring (area) vs. an open polyline. */
  closed: boolean;
  /** Vertices in metres (x=east, y=south), rounded to mm. */
  points: Point[];
}

/** A point-of-interest label (restaurant, shop, …) around the venue. */
interface Poi {
  name: string;
  /** Coarse category → icon/colour on the map. */
  category: 'restaurant' | 'cafe' | 'fast_food' | 'bar' | 'shop' | 'service';
  point: Point;
}

interface Basemap {
  generatedAt: string;
  origin: typeof CON_ORIGIN;
  source: string;
  license: string;
  bbox: typeof BBOX;
  features: Feature[];
  pois: Poi[];
}

/** Map an OSM amenity/shop tag to a coarse POI category (null → drop). */
function poiCategory(t: Record<string, string>): Poi['category'] | null {
  switch (t.amenity ?? '') {
    case 'restaurant':
      return 'restaurant';
    case 'cafe':
      return 'cafe';
    case 'fast_food':
      return 'fast_food';
    case 'bar':
    case 'pub':
      return 'bar';
    case 'bank':
    case 'pharmacy':
    case 'fuel':
      return 'service';
    default:
      return t.shop != null ? 'shop' : null;
  }
}

/** Classify an OSM way into a coarse render kind, or null to drop it. */
function classify(way: OverpassElement): { kind: Feature['kind']; closed: boolean } | null {
  const t = way.tags ?? {};
  if (t.building != null) return { kind: 'building', closed: true };
  if (t.highway != null) {
    const path = t.highway === 'footway' || t.highway === 'path' || t.highway === 'steps';
    return { kind: path ? 'path' : 'road', closed: false };
  }
  if (t.amenity === 'parking') return { kind: 'parking', closed: true };
  if (t.railway != null) return { kind: 'rail', closed: false };
  if (t.waterway != null) return { kind: 'water', closed: false };
  return null;
}

const round = (n: number) => Math.round(n * 1000) / 1000; // mm precision
const projRound = (lat: number, lon: number): Point => {
  const p = project({ lat, lon });
  return { x: round(p.x), y: round(p.y) };
};

function toFeature(way: OverpassElement): Feature | null {
  const geom = way.geometry;
  if (!geom || geom.length < 2) return null;
  const cls = classify(way);
  if (!cls) return null;

  const hotel = HOTELS[way.id];
  const points = geom.map((g) => projRound(g.lat, g.lon));
  const name = way.tags?.name;

  return {
    kind: hotel ? 'hotel' : cls.kind,
    ...(hotel ? { id: hotel.id, name: hotel.name } : name ? { name } : {}),
    closed: cls.closed,
    points,
  };
}

function toPoi(el: OverpassElement): Poi | null {
  const t = el.tags;
  const name = t?.name;
  if (!name) return null; // an unnamed POI is not worth a label
  const category = poiCategory(t);
  if (!category) return null;
  const at = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
  if (!at || at.lat == null || at.lon == null) return null;
  return { name, category, point: projRound(at.lat, at.lon) };
}

async function main() {
  const query = overpassQuery();
  console.log(`Overpass bbox ${BBOX.s.toFixed(5)},${BBOX.w.toFixed(5)} .. ${BBOX.n.toFixed(5)},${BBOX.e.toFixed(5)}`);

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: 'data=' + encodeURIComponent(query),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass returns 406 without an identifying User-Agent.
      'User-Agent': 'fureh-schedules-basemap/0.1 (https://events.fureh.ca)',
    },
  });
  if (!res.ok) throw new Error(`Overpass → HTTP ${res.status}`);
  const raw = (await res.json()) as OverpassResponse;
  await writeFile(RAW_OUT, JSON.stringify(raw, null, 0) + '\n', 'utf8');
  console.log(`Fetched ${raw.elements.length} ways → ${RAW_OUT}`);

  const features = raw.elements.map(toFeature).filter((f): f is Feature => f !== null);

  // Fail loudly if a footprint went missing — the whole map hangs off these two.
  const hotelIds = new Set(features.filter((f) => f.kind === 'hotel').map((f) => f.id));
  for (const { id, name } of Object.values(HOTELS)) {
    if (!hotelIds.has(id)) throw new Error(`hotel footprint '${id}' (${name}) not found in Overpass result`);
  }

  // POIs, de-duped by name (a place mapped as both a node and a building appears
  // twice) — keep the first, they land within a few metres of each other.
  const seenPoi = new Set<string>();
  const pois = raw.elements
    .map(toPoi)
    .filter((p): p is Poi => p !== null)
    .filter((p) => (seenPoi.has(p.name) ? false : (seenPoi.add(p.name), true)));

  const basemap: Basemap = {
    generatedAt: new Date().toISOString(),
    origin: CON_ORIGIN,
    source: 'OpenStreetMap via Overpass API',
    license: '© OpenStreetMap contributors, ODbL',
    bbox: BBOX,
    features,
    pois,
  };
  await writeFile(OUT, JSON.stringify(basemap, null, 2) + '\n', 'utf8');

  const byKind = features.reduce<Record<string, number>>((a, f) => ((a[f.kind] = (a[f.kind] ?? 0) + 1), a), {});
  console.log(`Wrote ${features.length} features + ${pois.length} POIs → ${OUT}`);
  console.log('  by kind:', byKind);
  console.log('  named roads:', features.filter((f) => f.kind === 'road' && f.name).length);
  for (const f of features.filter((x) => x.kind === 'hotel')) {
    const xs = f.points.map((p) => p.x), ys = f.points.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    console.log(`  hotel ${f.id}: ${f.points.length} pts, span ${w.toFixed(1)}×${h.toFixed(1)} m`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
