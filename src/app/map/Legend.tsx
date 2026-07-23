import { LegendIcon } from './icons';

/**
 * Map legend. Colour swatches map to the room fills in map.css (kept in sync by
 * class name), and the facility glyphs reuse the same icon set drawn on the map.
 * Floor-specific keys (rooms, facilities) hide on the site/building view where no
 * floor plan is drawn.
 */
export function Legend({ showFloorKeys }: { showFloorKeys: boolean }) {
  return (
    <div class="map-legend" aria-label="Map legend">
      <span class="legend-item">
        <span class="legend-swatch room-panel" />
        Session room
      </span>
      <span class="legend-item">
        <span class="legend-swatch room-starred" />★ Your stars
      </span>
      {showFloorKeys && (
        <>
          <span class="legend-item">
            <span class="legend-swatch room-amenity" />
            Amenity
          </span>
          <span class="legend-item">
            <span class="legend-swatch room-entrance" />
            Entrance
          </span>
          <span class="legend-item">
            <LegendIcon kind="washroom" />
            Washroom
          </span>
          <span class="legend-item">
            <LegendIcon kind="elevator" />
            Elevator
          </span>
          <span class="legend-item">
            <LegendIcon kind="stairs" />
            Stairs
          </span>
        </>
      )}
      <span class="legend-item">
        <span class="legend-swatch swatch-hotel" />
        Con building
      </span>
    </div>
  );
}
