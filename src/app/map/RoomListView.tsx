import './map.css';
import type { Occurrence } from '../../data/expand';
import { useStars } from '../stars';

/**
 * Room LIST — the map alternative for cons with no traced SVG floor plan (ToS,
 * Canfurence). It answers the same "where are my sessions" question the SVG map
 * does, but from the schedule alone: one row per room, its session count, and —
 * when you have starred sessions there — how many.
 *
 * A11y is the hard constraint (a legally-blind primary user): the starred signal
 * is carried by SHAPE + TEXT (a "★ N" badge with a spelled-out aria-label),
 * NEVER by colour or opacity alone, so it survives a monochrome / high-contrast
 * render and is announced by a screen reader.
 */
export function RoomListView({ occurrences }: { occurrences: Occurrence[] }) {
  const stars = useStars();

  // Single pass: per-room total + starred counts. `stars` is a Set<OccurrenceId>.
  const byRoom = new Map<string, { total: number; starred: number }>();
  for (const o of occurrences) {
    if (!o.room) continue;
    const cur = byRoom.get(o.room) ?? { total: 0, starred: 0 };
    cur.total += 1;
    if (stars.has(o.id)) cur.starred += 1;
    byRoom.set(o.room, cur);
  }

  // Distinct room names, alphabetized (locale-aware) for a stable, scannable list.
  const rooms = [...byRoom.keys()].sort((a, b) => a.localeCompare(b));

  if (rooms.length === 0) {
    return (
      <div class="room-list-wrap">
        <p class="empty">No rooms in this schedule yet.</p>
      </div>
    );
  }

  return (
    <div class="room-list-wrap">
      <ul class="room-list" role="list">
        {rooms.map((room) => {
          const { total, starred } = byRoom.get(room)!;
          return (
            <li key={room} class="room-list-item">
              <span class="room-name">{room}</span>
              <span class="room-meta">
                <span class="room-count">
                  {total} {total === 1 ? 'session' : 'sessions'}
                </span>
                {starred > 0 && (
                  <span
                    class="room-stars"
                    aria-label={`${starred} starred`}
                  >
                    <span aria-hidden="true">★ {starred}</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
