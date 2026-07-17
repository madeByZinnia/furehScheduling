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
  const [open, setOpen] = useState(false);
  const hasDesc = occ.abstract.trim().length > 0;
  const hasMeta = Boolean(occ.room) || Boolean(occ.track);
  const panelId = `desc-${occ.id}`;

  // Phrasing-only content so it can live inside the <button> disclosure.
  const meta = hasMeta ? (
    <span class="meta">
      {occ.room}
      {occ.room && occ.track ? ' · ' : ''}
      {occ.track ? <span class="track">{occ.track}</span> : null}
    </span>
  ) : null;

  return (
    <div class={`event-row${open ? ' is-open' : ''}`}>
      <div class="body">
        {hasDesc ? (
          <button
            type="button"
            class="disclosure"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
          >
            <span class="disc-main">
              <span class="title">{occ.title}</span>
              {meta}
            </span>
            <span class="chevron" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
          </button>
        ) : (
          <div class="disc-main static">
            <span class="title">{occ.title}</span>
            {meta}
          </div>
        )}
        {open && hasDesc && (
          <div id={panelId} class="desc">
            {occ.abstract}
          </div>
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
