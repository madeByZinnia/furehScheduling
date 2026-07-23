import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  project,
  unproject,
  bounds,
  CON_ORIGIN,
  type LatLon,
} from './geo';

// Points anywhere within ~1 km of the con — the projection is only claimed to be
// accurate in the local tangent plane, so the property tests stay in that band.
const nearOrigin = fc.record({
  lat: fc.double({ min: CON_ORIGIN.lat - 0.01, max: CON_ORIGIN.lat + 0.01, noNaN: true }),
  lon: fc.double({ min: CON_ORIGIN.lon - 0.01, max: CON_ORIGIN.lon + 0.01, noNaN: true }),
});

describe('project / unproject', () => {
  it('the origin maps to (0,0)', () => {
    const p = project(CON_ORIGIN);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('round-trips lat/lon → metres → lat/lon (property)', () => {
    fc.assert(
      fc.property(nearOrigin, (ll: LatLon) => {
        const back = unproject(project(ll));
        expect(back.lat).toBeCloseTo(ll.lat, 9);
        expect(back.lon).toBeCloseTo(ll.lon, 9);
      }),
    );
  });

  it('north is up in the world = down in SVG (a point due north has negative y)', () => {
    const north = project({ lat: CON_ORIGIN.lat + 0.001, lon: CON_ORIGIN.lon });
    expect(north.y).toBeLessThan(0);
    expect(north.x).toBeCloseTo(0, 6);
  });

  it('east is +x (a point due east has positive x)', () => {
    const east = project({ lat: CON_ORIGIN.lat, lon: CON_ORIGIN.lon + 0.001 });
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 6);
  });

  it('scale is metric: 0.001° of latitude ≈ 111 m', () => {
    const p = project({ lat: CON_ORIGIN.lat + 0.001, lon: CON_ORIGIN.lon });
    // one thousandth of a degree of latitude is ~111.13 m anywhere on Earth
    expect(Math.abs(p.y)).toBeGreaterThan(110);
    expect(Math.abs(p.y)).toBeLessThan(112);
  });

  it('the two hotels sit ~110 m apart (Wyndham vs Delta centroids)', () => {
    const wyndham = project({ lat: 53.482617, lon: -113.493799 });
    const delta = project({ lat: 53.48162, lon: -113.49365 });
    const d = Math.hypot(wyndham.x - delta.x, wyndham.y - delta.y);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(130);
  });
});

describe('bounds', () => {
  it('returns null for no points', () => {
    expect(bounds([])).toBeNull();
  });

  it('encloses every point', () => {
    fc.assert(
      fc.property(fc.array(nearOrigin, { minLength: 1, maxLength: 40 }), (lls) => {
        const pts = lls.map((ll) => project(ll));
        const b = bounds(pts)!;
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(b.minX);
          expect(p.x).toBeLessThanOrEqual(b.maxX);
          expect(p.y).toBeGreaterThanOrEqual(b.minY);
          expect(p.y).toBeLessThanOrEqual(b.maxY);
        }
      }),
    );
  });
});
