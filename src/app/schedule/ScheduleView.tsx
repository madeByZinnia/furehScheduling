import { Fragment } from 'preact';
import type { Ref, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Occurrence } from '../../data/expand';
import { conDay } from '../../data/expand';
import { useNow } from '../useNow';
import { formatTime, formatWeekdayShort, formatWeekdayLong, formatDayNum } from '../datetime';
import { useIsStarred, toggleStar, useStars } from '../stars';
import { Markdown } from '../markdown';
import {
  filterOccurrences,
  starredOccurrences,
  dayTabs,
  defaultDayIndex,
  groupByTime,
  nowSeparatorIndex,
  type DayTab,
} from './filter';

export function ScheduleView({ occurrences }: { occurrences: Occurrence[] }) {
  const [query, setQuery] = useState('');
  const [favesOnly, setFavesOnly] = useState(false);
  const stars = useStars();
  const nowDate = useNow();
  const tabs = useMemo(() => dayTabs(occurrences), [occurrences]);
  const [dayIndex, setDayIndex] = useState(() => defaultDayIndex(tabs, nowDate));

  const today = conDay(nowDate.toISOString());

  // Search and favourites are FILTERS that compose and span all days; the day
  // tabs are a browse-only affordance that steps aside while either is active.
  const searching = query.trim().length > 0;
  const allDaysMode = searching || favesOnly;

  // Favourites narrows first (all days), then the query narrows within it.
  const base = useMemo(
    () => (favesOnly ? starredOccurrences(occurrences, stars) : occurrences),
    [occurrences, favesOnly, stars],
  );
  const filtered = useMemo(() => filterOccurrences(base, query), [base, query]);
  // Only needed for the all-days (search/faves) layout; browse mode never reads it.
  const resultDays = useMemo(
    () => (allDaysMode ? dayTabs(filtered) : []),
    [allDaysMode, filtered],
  );

  const activeTab = tabs[dayIndex] ?? tabs[0];

  // Show the FAB only when today is a con day AND a now separator is actually on
  // screen — guaranteed in browse mode (jumping switches to today), and in
  // all-days mode only when today has matches (else jumping would be inert).
  const todayIndex = tabs.findIndex((t) => t.day === today);
  const showFab = todayIndex !== -1 && (!allDaysMode || resultDays.some((d) => d.day === today));
  const nowSepRef = useRef<HTMLDivElement>(null);
  const scrollToNow = useScrollFocusOnDemand(nowSepRef);
  const jumpToNow = () => {
    // In browse mode the separator lives on today's tab; switch to it first.
    if (!allDaysMode && todayIndex !== -1 && dayIndex !== todayIndex) setDayIndex(todayIndex);
    scrollToNow();
  };

  return (
    <>
      <input
        type="search"
        class="search"
        placeholder="Search title, room, category…"
        aria-label="Search the schedule"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />

      <FavouritesFilter
        favesOnly={favesOnly}
        onToggle={() => setFavesOnly((v) => !v)}
        starCount={stars.size}
        searching={searching}
        query={query}
        count={filtered.length}
      />

      <DayTabs tabs={tabs} dayIndex={dayIndex} active={!allDaysMode} onPick={setDayIndex} />

      {allDaysMode ? (
        <AllDaysResults
          days={resultDays}
          occurrences={filtered}
          today={today}
          nowDate={nowDate}
          nowSepRef={nowSepRef}
          favesOnly={favesOnly}
          searching={searching}
          query={query}
          starCount={stars.size}
        />
      ) : (
        <section aria-label={activeTab ? formatWeekdayLong(activeTab.startISO) : 'Schedule'}>
          <DaySection
            occurrences={occurrences}
            day={activeTab?.day ?? ''}
            today={today}
            nowDate={nowDate}
            nowSepRef={nowSepRef}
            headingLevel="h2"
          />
        </section>
      )}

      {showFab && <JumpToNowFab onClick={jumpToNow} />}
    </>
  );
}

/**
 * Returns a trigger that, on the next paint after it's called, focuses `ref` and
 * scrolls it to centre. Deferring through a tick lets a caller switch tabs first
 * (so the target mounts) before the scroll runs. Focus (with preventScroll) puts
 * keyboard/AT users on the target; the centred scroll then wins the position.
 */
function useScrollFocusOnDemand(ref: RefObject<HTMLElement>): () => void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick === 0) return;
    const node = ref.current;
    if (!node) return;
    if (typeof node.focus === 'function') node.focus({ preventScroll: true });
    if (typeof node.scrollIntoView !== 'function') return;
    const reduce =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [tick]);
  return () => setTick((t) => t + 1);
}

/**
 * The favourites toggle + its status line. Sits between the search input and the
 * browse-only day tabs, grouping the two filters that compose (search narrows
 * within favourites); the status line names the active filters so that's clear.
 */
function FavouritesFilter({
  favesOnly,
  onToggle,
  starCount,
  searching,
  query,
  count,
}: {
  favesOnly: boolean;
  onToggle: () => void;
  starCount: number;
  searching: boolean;
  query: string;
  count: number;
}) {
  const matches = `${count} ${count === 1 ? 'match' : 'matches'}`;
  const statusText = searching
    ? `Favourites matching “${query.trim()}” · ${matches}`
    : `Showing favourites · ${matches}`;

  return (
    <>
      <div class="filter-bar" role="group" aria-label="Filters">
        <button type="button" class="faves-toggle" aria-pressed={favesOnly} onClick={onToggle}>
          ★ Favourites{starCount ? ` (${starCount})` : ''}
        </button>
      </div>
      {favesOnly && (
        <p class="filter-status" role="status">
          {statusText}
        </p>
      )}
    </>
  );
}

/** Browse-only day picker; steps aside (dimmed + disabled) while a filter is active. */
function DayTabs({
  tabs,
  dayIndex,
  active,
  onPick,
}: {
  tabs: DayTab[];
  dayIndex: number;
  active: boolean;
  onPick: (i: number) => void;
}) {
  // A group of toggle buttons, not an ARIA tablist: there is no tab/tabpanel
  // widget here, just a filter, so aria-pressed is the honest, fully-keyboard-
  // native semantics.
  return (
    <div class={`day-tabs${active ? '' : ' dimmed'}`} role="group" aria-label="Filter by day">
      {tabs.map((tab, i) => (
        <button
          key={tab.day}
          type="button"
          class="day-tab"
          aria-pressed={active && i === dayIndex}
          aria-label={formatWeekdayLong(tab.startISO)}
          disabled={!active}
          onClick={() => onPick(i)}
        >
          <span>{formatWeekdayShort(tab.startISO)}</span>
          <small>{formatDayNum(tab.startISO)}</small>
        </button>
      ))}
    </div>
  );
}

/** Floating "jump to now" button — scrolls the now separator into view. */
function JumpToNowFab({ onClick }: { onClick: () => void }) {
  // A text label (not an icon): "jump" can scroll up or down, so no arrow reads
  // right; the words are unambiguous. Its accessible name is the visible text.
  return (
    <button type="button" class="fab" onClick={onClick}>
      Jump to now
    </button>
  );
}

/** All-days results, shared by search and favourites (day headers + sections). */
function AllDaysResults({
  days,
  occurrences,
  today,
  nowDate,
  nowSepRef,
  favesOnly,
  searching,
  query,
  starCount,
}: {
  days: { day: string; startISO: string }[];
  occurrences: Occurrence[];
  today: string;
  nowDate: Date;
  nowSepRef: Ref<HTMLDivElement>;
  favesOnly: boolean;
  searching: boolean;
  query: string;
  starCount: number;
}) {
  const n = occurrences.length;

  if (n === 0) {
    const msg =
      favesOnly && !searching && starCount === 0
        ? 'No favourites yet — tap ☆ on a session to add it here.'
        : favesOnly
          ? `No favourites match “${query.trim()}”`
          : `No sessions match “${query.trim()}”`;
    // A live region on every empty state — the message (esp. the actionable
    // "tap ☆ to add" hint) must be announced, not just the filter-status count.
    return (
      <p class="results-summary" role="status">
        {msg}
      </p>
    );
  }

  return (
    <>
      {!favesOnly && (
        <p class="results-summary" role="status">
          {`${n} ${n === 1 ? 'match' : 'matches'} · ${days.length} ${days.length === 1 ? 'day' : 'days'}`}
        </p>
      )}
      {days.map((d) => (
        <section key={d.day} class="result-day" aria-label={formatWeekdayLong(d.startISO)}>
          <h2 class="day-header">
            {formatWeekdayLong(d.startISO)} · {formatDayNum(d.startISO)}
          </h2>
          <DaySection
            occurrences={occurrences}
            day={d.day}
            today={today}
            nowDate={nowDate}
            nowSepRef={nowSepRef}
            headingLevel="h3"
          />
        </section>
      ))}
    </>
  );
}

/**
 * One day's time-groups with the "now" separator inserted at the right spot.
 * The separator renders only on today's section (there is exactly one), so it
 * is the single scroll target for "jump to now" across browse/search/faves.
 */
function DaySection({
  occurrences,
  day,
  today,
  nowDate,
  nowSepRef,
  headingLevel,
}: {
  occurrences: Occurrence[];
  day: string;
  today: string;
  nowDate: Date;
  nowSepRef: Ref<HTMLDivElement>;
  headingLevel: 'h2' | 'h3';
}) {
  const groups = groupByTime(occurrences, day);
  const isToday = day === today;
  const sepIndex = isToday ? nowSeparatorIndex(groups, nowDate) : -1;
  const TimeHead = headingLevel;

  return (
    <>
      {sepIndex === 0 && <NowSeparator nowDate={nowDate} sepRef={nowSepRef} />}
      {groups.map((group, i) => (
        <Fragment key={group.startISO}>
          <div class="time-group">
            <TimeHead class="time-head">{formatTime(group.startISO)}</TimeHead>
            {group.items.map((occ) => (
              <EventRow key={occ.id} occ={occ} />
            ))}
          </div>
          {sepIndex === i + 1 && <NowSeparator nowDate={nowDate} sepRef={nowSepRef} />}
        </Fragment>
      ))}
    </>
  );
}

function NowSeparator({ nowDate, sepRef }: { nowDate: Date; sepRef: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={sepRef}
      // Programmatic focus target for "jump to now"; -1 keeps it out of the tab
      // order but lets node.focus() land here so AT announces the "now" position.
      tabIndex={-1}
      class="now-sep"
      role="separator"
      aria-label={`Now, ${formatTime(nowDate.toISOString())}`}
    >
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
            <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M9 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        ) : (
          <div class="disc-main static">
            <span class="title">{occ.title}</span>
            {meta}
          </div>
        )}
        {open && hasDesc && (
          <div id={panelId} class="desc">
            <Markdown text={occ.abstract} />
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
