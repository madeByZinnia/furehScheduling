import './map.css';
import { useMemo, useRef, useState } from 'preact/hooks';
import scheduleJson from '../../data/schedule.json';
import type { Point, Bounds } from '../../data/geo';
import { useStars } from '../stars';
import { usePanZoom, type ViewBox } from './usePanZoom';
import { FacilityIcon } from './icons';
import { Legend } from './Legend';
import {
  basemap,
  buildings,
  buildingRoomNames,
  floorRooms,
  locateScheduleRoom,
  pois,
  streetLabels,
  roomsMeta,
  type RoomKind,
  type RoomShape,
} from './geometry';

const STREETS = streetLabels();

const ICON_KINDS = new Set<RoomKind>(['washroom', 'elevator', 'stairs', 'entrance']);

/** Fit a facility icon to the smaller side of its room, clamped to a legible band. */
function iconSize(poly: Point[]): number {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const side = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return Math.max(3, Math.min(7, side * 0.9));
}

// Every occurrence carries its schedule room string; that's the whole bridge from
// a local star to a place on the map (a star names the room → the room names the
// floor). No backend needed — this is your OWN stars, client-side.
const OCCURRENCES = (scheduleJson as { occurrences: { id: string; room: string | null }[] }).occurrences;

// ── viewBox helpers ──────────────────────────────────────────────────────────

function pad(b: Bounds, frac: number): ViewBox {
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const px = w * frac;
  const py = h * frac;
  return { x: b.minX - px, y: b.minY - py, w: w + 2 * px, h: h + 2 * py };
}

function union(bs: Bounds[]): Bounds {
  return {
    minX: Math.min(...bs.map((b) => b.minX)),
    minY: Math.min(...bs.map((b) => b.minY)),
    maxX: Math.max(...bs.map((b) => b.maxX)),
    maxY: Math.max(...bs.map((b) => b.maxY)),
  };
}

// Site view frames the two hotels (with enough padding to show the streets
// around them) — NOT the whole Overpass bbox, which would shrink them to specks.
const SITE_VIEW = pad(union(buildings().map((b) => b.bounds)), 0.6);

// Zoom-out limit: the full baked extent (all features + POIs), so the user can
// pull back to see the surrounding restaurants and streets, but no further.
function pointsBounds(pts: Point[]): Bounds {
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}
const FULL_VIEW = pad(
  pointsBounds([...basemap.features.flatMap((f) => f.points), ...pois.map((p) => p.point)]),
  0.03,
);

function toPath(points: Point[], closed: boolean): string {
  if (points.length === 0) return '';
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  return closed ? d + ' Z' : d;
}

const vbStr = (v: ViewBox) => `${v.x} ${v.y} ${v.w} ${v.h}`;

// ── component ────────────────────────────────────────────────────────────────

const BUILDINGS = buildings();

export function MapView() {
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [floorId, setFloorId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Look up in the STABLE module-level list — getBuilding() rebuilds fresh
  // objects each call, and an ever-changing `building` identity would re-fire the
  // framing effect below every render and clobber the user's pan/zoom.
  const building = buildingId ? BUILDINGS.find((b) => b.id === buildingId) : undefined;

  // Your-stars overlay: which schedule rooms you've starred, and how many starred
  // sessions sit in each building (a building-level badge for floors not drawn).
  const stars = useStars();
  const starHits = useMemo(() => {
    const starIds = stars as unknown as Set<string>;
    const rooms = new Set<string>();
    const perBuilding = new Map<string, number>();
    for (const o of OCCURRENCES) {
      if (!o.room || !starIds.has(o.id)) continue;
      rooms.add(o.room);
      const loc = locateScheduleRoom(o.room);
      if (loc) perBuilding.set(loc.building, (perBuilding.get(loc.building) ?? 0) + 1);
    }
    return { rooms, perBuilding };
  }, [stars]);

  // The target framing for the current selection: site → both hotels; building or
  // floor → that footprint. The view snaps to it when the selection changes.
  const target = useMemo<ViewBox>(
    () => (building ? pad(building.bounds, 0.25) : SITE_VIEW),
    [building],
  );
  const { view, handlers } = usePanZoom(svgRef, target, FULL_VIEW);

  const rooms: RoomShape[] = building && floorId ? floorRooms(building.id, floorId) : [];

  // While a building's floor is open, hide any outdoor POI that duplicates one of
  // that building's rooms (e.g. the Sushi Toshi restaurant pin over the Wyndham
  // Sushi Toshi room). Every other POI stays.
  const visiblePois = useMemo(() => {
    if (!building || !floorId) return pois;
    const dup = buildingRoomNames(building.id);
    return pois.filter((p) => !dup.has(p.name.toLowerCase()));
  }, [building, floorId]);

  const selectBuilding = (id: string) => {
    if (buildingId === id) {
      setBuildingId(null);
      setFloorId(null);
      return;
    }
    setBuildingId(id);
    const b = BUILDINGS.find((x) => x.id === id);
    setFloorId(b?.floors[0]?.id ?? null); // auto-select Main
  };

  return (
    <div class="map-wrap">
      <Selector
        buildings={BUILDINGS}
        buildingId={buildingId}
        floorId={floorId}
        starsByBuilding={starHits.perBuilding}
        onBuilding={selectBuilding}
        onFloor={setFloorId}
      />

      <div class="map-stage">
        <svg
          ref={svgRef}
          class="map-svg"
          viewBox={vbStr(view)}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={
            building
              ? `Map of ${building.name}${floorId ? `, ${building.floors.find((f) => f.id === floorId)?.label} floor` : ''}`
              : 'Site map of the Wyndham and Delta hotels'
          }
          onPointerDown={handlers.onPointerDown}
          onPointerMove={handlers.onPointerMove}
          onPointerUp={handlers.onPointerUp}
          onPointerLeave={handlers.onPointerUp}
          onWheel={handlers.onWheel}
        >
          {/* clip the drawn floor to the real footprint — a hard guarantee that
              no room box is ever shown outside the building outline */}
          {building && (
            <defs>
              <clipPath id="floor-clip">
                <path d={toPath(building.footprint, true)} />
              </clipPath>
            </defs>
          )}

          {/* outdoor OSM basemap — always present, drawn beneath everything */}
          <g class="layer-basemap">
            {basemap.features.map((f, i) => (
              <path key={i} class={`feat feat-${f.kind}`} d={toPath(f.points, f.closed)} />
            ))}
          </g>

          {/* street names, angled along each road */}
          <g class="layer-streets">
            {STREETS.map((s) => (
              <text
                key={s.name}
                class="street-label"
                x={s.point.x}
                y={s.point.y}
                text-anchor="middle"
                transform={`rotate(${(s.angle * 180) / Math.PI} ${s.point.x} ${s.point.y})`}
              >
                {s.name}
              </text>
            ))}
          </g>

          {/* points of interest — restaurants & businesses around the venue */}
          <g class="layer-pois">
            {visiblePois.map((p) => (
              <g key={p.name} class={`poi poi-${p.category}`}>
                <circle cx={p.point.x} cy={p.point.y} r={1.6} />
                <text class="poi-label" x={p.point.x} y={p.point.y - 2.4} text-anchor="middle">
                  {p.name}
                </text>
              </g>
            ))}
          </g>

          {/* drawn floor: rooms + icons + labels, only when a floor is selected */}
          {rooms.length > 0 && (
            <g class="layer-floor" clip-path="url(#floor-clip)">
              {rooms.map((r) => {
                const starred = !!r.schedule && starHits.rooms.has(r.schedule);
                return (
                  <path
                    key={r.name}
                    class={`room room-${r.kind}${starred ? ' room-starred' : ''}`}
                    d={toPath(r.polygon, true)}
                  />
                );
              })}
              {rooms
                .filter((r) => ICON_KINDS.has(r.kind))
                .map((r) => (
                  <FacilityIcon key={`i-${r.name}`} kind={r.kind} cx={r.centroid.x} cy={r.centroid.y} size={iconSize(r.polygon)} />
                ))}
              {rooms.map((r) => (
                <RoomLabel key={`l-${r.name}`} room={r} starred={!!r.schedule && starHits.rooms.has(r.schedule)} />
              ))}
            </g>
          )}
        </svg>

        <p class="map-attribution">© OpenStreetMap contributors · ODbL</p>
        {roomsMeta.provisional && rooms.length > 0 && (
          <p class="map-provisional">Floor plan traced from the QRG — positions approximate</p>
        )}
      </div>

      <Legend showFloorKeys={rooms.length > 0} />
    </div>
  );
}

function RoomLabel({ room, starred }: { room: RoomShape; starred: boolean }) {
  // Label size in metres, fitted to the room so small adjacent rooms don't collide
  // (Delta 2nd's Fort McMurray/Red Deer/Medicine Hat sit shoulder to shoulder).
  // Vector text stays crisp at any magnification regardless.
  const primary = room.aka ?? room.name;
  const sub = room.aka ? room.name : null;
  const showName = room.kind === 'panel' || room.kind === 'amenity' || room.kind === 'desk';
  if (!showName) return null;
  const xs = room.polygon.map((p) => p.x);
  const width = Math.max(...xs) - Math.min(...xs);
  const label = (starred ? '★ ' : '') + primary;
  // ~0.55 em per char; clamp so it stays legible but never overruns a small room.
  const size = Math.max(1.4, Math.min(3, (width * 0.9) / (label.length * 0.55)));
  return (
    <text
      class={`room-label label-${room.kind}${starred ? ' label-starred' : ''}`}
      style={`font-size:${size.toFixed(2)}px`}
      x={room.centroid.x}
      y={room.centroid.y}
      text-anchor="middle"
    >
      <tspan x={room.centroid.x} dy={sub ? '-0.3em' : '0.35em'}>
        {starred ? '★ ' : ''}
        {primary}
      </tspan>
      {sub && (
        <tspan class="room-sub" x={room.centroid.x} dy="1.1em">
          {sub}
        </tspan>
      )}
    </text>
  );
}

// ── selector (shared building/floor control — bead aau.4) ────────────────────

function Selector({
  buildings,
  buildingId,
  floorId,
  starsByBuilding,
  onBuilding,
  onFloor,
}: {
  buildings: ReturnType<typeof import('./geometry').buildings>;
  buildingId: string | null;
  floorId: string | null;
  starsByBuilding: Map<string, number>;
  onBuilding: (id: string) => void;
  onFloor: (id: string) => void;
}) {
  const active = buildings.find((b) => b.id === buildingId);
  return (
    <div class="map-selector" role="group" aria-label="Choose a building and floor">
      <div class="sel-row">
        {buildings.map((b) => {
          const stars = starsByBuilding.get(b.id) ?? 0;
          return (
            <button
              key={b.id}
              type="button"
              class="sel-pill"
              aria-pressed={b.id === buildingId}
              onClick={() => onBuilding(b.id)}
            >
              {b.name}
              {stars > 0 && (
                <span class="sel-stars" title={`${stars} starred here`}>
                  ★ {stars}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active && (
        <div class="sel-row sel-floors">
          {active.floors.map((f) => (
            <button
              key={f.id}
              type="button"
              class="sel-pill sel-floor"
              aria-pressed={f.id === floorId}
              onClick={() => onFloor(f.id)}
            >
              {f.label}
              {f.underground && <span class="sel-tag">underground</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
