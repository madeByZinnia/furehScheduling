import { Fragment } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import type { Occurrence } from '../../data/expand';
import { conDay } from '../../data/expand';
import { now } from '../now';
import { formatTime, formatWeekdayShort, formatWeekdayLong, formatDayNum } from '../datetime';
import { useIsStarred, toggleStar } from '../stars';
import {
  filterOccurrences,
  dayTabs,
  defaultDayIndex,
  groupByTime,
  nowSeparatorIndex,
} from './filter';

export function ScheduleView({ occurrences }: { occurrences: Occurrence[] }) {
  const [query, setQuery] = useState('');
  const nowDate = useMemo(() => now(), []);
  const tabs = useMemo(() => dayTabs(occurrences), [occurrences]);
  const [dayIndex, setDayIndex] = useState(() => defaultDayIndex(tabs, nowDate));

  const activeTab = tabs[dayIndex] ?? tabs[0];
  const filtered = useMemo(() => filterOccurrences(occurrences, query), [occurrences, query]);
  const groups = useMemo(
    () => (activeTab ? groupByTime(filtered, activeTab.day) : []),
    [filtered, activeTab],
  );

  // The "now" separator only makes sense on the day that actually contains now.
  const isToday = activeTab?.day === conDay(nowDate.toISOString());
  const sepIndex = isToday ? nowSeparatorIndex(groups, nowDate) : -1;

  return (
    <>
      <input
        type="search"
        class="search"
        placeholder="Search title, room, track…"
        aria-label="Search the schedule"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />

      <nav class="day-tabs" role="tablist" aria-label="Schedule day">
        {tabs.map((tab, i) => (
          <button
            key={tab.day}
            type="button"
            role="tab"
            class="day-tab"
            aria-selected={i === dayIndex}
            aria-label={formatWeekdayLong(tab.startISO)}
            onClick={() => setDayIndex(i)}
          >
            <span>{formatWeekdayShort(tab.startISO)}</span>
            <small>{formatDayNum(tab.startISO)}</small>
          </button>
        ))}
      </nav>

      <section aria-label={activeTab ? formatWeekdayLong(activeTab.startISO) : 'Schedule'}>
        {sepIndex === 0 && <NowSeparator nowDate={nowDate} />}
        {groups.length === 0 && <p class="empty">No sessions match “{query}”.</p>}
        {groups.map((group, i) => (
          <Fragment key={group.startISO}>
            <div class="time-group">
              <h2>{formatTime(group.startISO)}</h2>
              {group.items.map((occ) => (
                <EventRow key={occ.id} occ={occ} />
              ))}
            </div>
            {sepIndex === i + 1 && <NowSeparator nowDate={nowDate} />}
          </Fragment>
        ))}
      </section>
    </>
  );
}

function NowSeparator({ nowDate }: { nowDate: Date }) {
  return (
    <div class="now-sep" role="separator" aria-label={`Now, ${formatTime(nowDate.toISOString())}`}>
      Now · {formatTime(nowDate.toISOString())}
    </div>
  );
}

function EventRow({ occ }: { occ: Occurrence }) {
  const starred = useIsStarred(occ.id);
  const roomTrack = [occ.room, occ.track].filter(Boolean);
  return (
    <div class="event-row">
      <div class="body">
        <p class="title">{occ.title}</p>
        {roomTrack.length > 0 && (
          <p class="meta">
            {occ.room}
            {occ.room && occ.track && ' · '}
            {occ.track && <span class="track">{occ.track}</span>}
          </p>
        )}
      </div>
      <button
        type="button"
        class="star"
        aria-pressed={starred}
        aria-label={starred ? `Unstar ${occ.title}` : `Star ${occ.title}`}
        onClick={() => toggleStar(occ.id)}
      >
        {starred ? '★' : '☆'}
      </button>
    </div>
  );
}
