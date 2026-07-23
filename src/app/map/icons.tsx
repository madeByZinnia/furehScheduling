import type { RoomKind } from './geometry';

/**
 * Schematic facility glyphs, each drawn in a unit box centred on the origin
 * (−0.5..0.5) so they can be dropped anywhere via a translate+scale transform.
 * Strokes use currentColor + non-scaling-stroke, so colour follows the theme and
 * lines stay crisp at any zoom. The legend names them, so they can stay minimal.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.4,
  'stroke-linejoin': 'round',
  'stroke-linecap': 'round',
  'vector-effect': 'non-scaling-stroke',
} as const;

/** The glyph paths, in the unit box. */
function glyph(kind: RoomKind) {
  switch (kind) {
    case 'stairs':
      return (
        <path
          d="M-0.42 0.42 L-0.42 0.18 L-0.18 0.18 L-0.18 -0.06 L0.06 -0.06 L0.06 -0.3 L0.42 -0.3"
          {...STROKE}
        />
      );
    case 'elevator':
      return (
        <>
          <rect x={-0.4} y={-0.42} width={0.8} height={0.84} rx={0.08} {...STROKE} />
          <path d="M-0.15 -0.05 L0 -0.24 L0.15 -0.05 Z M-0.15 0.05 L0 0.24 L0.15 0.05 Z" fill="currentColor" stroke="none" />
        </>
      );
    case 'washroom':
      // side-view toilet (tank + seat + pedestal) — matches the QRG's bathroom icon
      return (
        <g fill="currentColor" stroke="none">
          <rect x={-0.3} y={-0.42} width={0.15} height={0.26} rx={0.02} />
          <rect x={-0.34} y={-0.16} width={0.54} height={0.13} rx={0.065} />
          <path d="M-0.16 -0.03 L-0.10 0.36 L0.04 0.36 L0.10 -0.03 Z" />
        </g>
      );
    case 'entrance':
      // arrow entering a doorway (bar on the right)
      return (
        <>
          <path d="M0.3 -0.42 L0.3 0.42" {...STROKE} />
          <path d="M-0.4 0 L0.14 0 M-0.05 -0.18 L0.16 0 L-0.05 0.18" {...STROKE} />
        </>
      );
    case 'desk':
      // reception counter
      return (
        <>
          <rect x={-0.42} y={-0.12} width={0.84} height={0.34} rx={0.05} {...STROKE} />
          <path d="M-0.28 -0.12 L-0.28 -0.34 L0.28 -0.34 L0.28 -0.12" {...STROKE} />
        </>
      );
    case 'panel':
    case 'amenity':
    case 'structure':
      return null; // drawn as filled areas, not glyphs
  }
}

/** Facility glyph placed at (cx,cy) in metre space, `size` metres across. */
export function FacilityIcon({ kind, cx, cy, size }: { kind: RoomKind; cx: number; cy: number; size: number }) {
  return (
    <g class="facility-icon" transform={`translate(${cx} ${cy}) scale(${size})`}>
      {glyph(kind)}
    </g>
  );
}

/** Same glyph in a fixed 24×24 box for the HTML legend. */
export function LegendIcon({ kind }: { kind: RoomKind }) {
  return (
    <svg class="legend-icon" viewBox="-0.6 -0.6 1.2 1.2" width="20" height="20" aria-hidden="true">
      {glyph(kind)}
    </svg>
  );
}
