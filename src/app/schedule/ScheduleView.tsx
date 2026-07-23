import { Fragment } from 'preact';
import type { Ref, RefObject } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Occurrence } from '../../data/expand';
import { conDay } from '../../data/expand';
import { useNow } from '../useNow';
import { activeCon } from '../con';
import { formatTime, formatWeekdayShort, formatWeekdayLong, formatDayNum } from '../datetime';
import { useIsStarred, toggleStar, useStars } from '../stars';
import { Markdown } from '../markdown';
import { useCrew } from '../crew';
import { goingByOccurrence, crewFavPickerMembers, type CrewMember } from '../crew-index';
import type { Roster } from '../crewSync';
import { getTelegramSession } from '../telegram-session';
import { Avatar } from '../Avatar';
import {
  whoseFavesBase,
  selectedMemberName,
  whoseFavesStatus,
  whoseFavesEmpty,
  type WhoseFaves,
} from './whose';
import {
  filterOccurrences,
  dayTabs,
  defaultDayIndex,
  groupByTime,
  nowSeparatorIndex,
  type DayTab,
} from './filter';

const EMPTY_ROSTER: Roster = [];
/** Empty per-occurrence "going" lookup — a stable ref for the no-crew case. */
const EMPTY_GOING: Map<string, CrewMember[]> = new Map();

export function ScheduleView({ occurrences }: { occurrences: Occurrence[] }) {
  const [query, setQuery] = useState('');
  const [whoseFaves, setWhoseFaves] = useState<WhoseFaves>('all');
  const stars = useStars();
  const nowDate = useNow();
  const selfId = getTelegramSession().user?.id ?? null;
  const { roster, pickerMembers, going } = useCrewFaves(whoseFaves, setWhoseFaves, selfId);

  // Bucket "today"/default-day in the ACTIVE con's timezone, not the device's
  // (and not the hardcoded Edmonton default of these helpers).
  const conTz = activeCon().tz;
  const tabs = useMemo(() => dayTabs(occurrences), [occurrences]);
  const [dayIndex, setDayIndex] = useState(() => defaultDayIndex(tabs, nowDate, conTz));

  const today = conDay(nowDate.toISOString(), conTz);

  // Search and the whose-favourites filter compose and span all days; the day
  // tabs are a browse-only affordance that steps aside while either is active.
  const searching = query.trim().length > 0;
  const allDaysMode = searching || whoseFaves !== 'all';

  const base = useMemo(
    () => whoseFavesBase(occurrences, whoseFaves, stars, roster),
    [occurrences, whoseFaves, stars, roster],
  );
  const filtered = useMemo(() => filterOccurrences(base, query), [base, query]);
  const resultDays = useMemo(() => (allDaysMode ? dayTabs(filtered) : []), [allDaysMode, filtered]);

  const activeTab = tabs[dayIndex] ?? tabs[0];
  const memberName = selectedMemberName(roster, whoseFaves);

  // Show the FAB only when today is a con day AND a now separator is actually on
  // screen — guaranteed in browse mode, and in all-days mode only when today has
  // matches (else jumping would be inert).
  const todayIndex = tabs.findIndex((t) => t.day === today);
  const showFab = todayIndex !== -1 && (!allDaysMode || resultDays.some((d) => d.day === today));
  const nowSepRef = useRef<HTMLDivElement>(null);
  const scrollToNow = useScrollFocusOnDemand(nowSepRef);
  const jumpToNow = () => {
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

      <WhoseFavourites
        value={whoseFaves}
        onSelect={setWhoseFaves}
        youCount={stars.size}
        members={pickerMembers}
        status={
          whoseFaves === 'all'
            ? null
            : whoseFavesStatus(whoseFaves, memberName, filtered.length, searching, query)
        }
      />

      <DayTabs tabs={tabs} dayIndex={dayIndex} active={!allDaysMode} onPick={setDayIndex} />

      {allDaysMode ? (
        <AllDaysResults
          days={resultDays}
          occurrences={filtered}
          going={going}
          today={today}
          nowDate={nowDate}
          nowSepRef={nowSepRef}
          filtered={whoseFaves !== 'all'}
          emptyMessage={whoseFavesEmpty(whoseFaves, memberName, searching, query, stars.size)}
        />
      ) : (
        <section aria-label={activeTab ? formatWeekdayLong(activeTab.startISO) : 'Schedule'}>
          <DaySection
            occurrences={occurrences}
            going={going}
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
 * Crew-derived state for the Schedule tab: the current roster, the picker's
 * member chips (non-ghost, minus you), and the per-occurrence "also going" map
 * (non-ghost crew who starred it, minus you — your own star is the filled ★).
 * Also resets the picker to "Everyone" if the selected member leaves the roster.
 */
function useCrewFaves(
  whoseFaves: WhoseFaves,
  setWhoseFaves: (next: WhoseFaves) => void,
  selfId: number | null,
): { roster: Roster; pickerMembers: CrewMember[]; going: Map<string, CrewMember[]> } {
  const crew = useCrew();
  const roster = crew.kind === 'ok' ? crew.roster : EMPTY_ROSTER;

  const pickerMembers = useMemo(
    () => crewFavPickerMembers(roster).filter((m) => m.userId !== selfId),
    [roster, selfId],
  );
  useEffect(() => {
    if (typeof whoseFaves === 'number' && !pickerMembers.some((m) => m.userId === whoseFaves)) {
      setWhoseFaves('all');
    }
  }, [whoseFaves, pickerMembers]);

  const going = useMemo(() => {
    if (roster.length === 0) return EMPTY_GOING;
    const raw = goingByOccurrence(roster);
    if (selfId === null) return raw;
    const others = new Map<string, CrewMember[]>();
    for (const [occId, members] of raw) {
      const trimmed = members.filter((m) => m.userId !== selfId);
      if (trimmed.length > 0) others.set(occId, trimmed);
    }
    return others;
  }, [roster, selfId]);

  return { roster, pickerMembers, going };
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
 * The "whose favourites" picker: a group of toggle chips that filter the schedule
 * to Everyone, You, or a crew member's stars. Not an ARIA tablist — it's a filter,
 * so aria-pressed is the honest, fully keyboard-native semantics (mirrors DayTabs).
 * The status line names the active filter. On plain web `members` is empty, so it
 * degrades to [Everyone · You].
 */
function WhoseFavourites({
  value,
  onSelect,
  youCount,
  members,
  status,
}: {
  value: WhoseFaves;
  onSelect: (next: WhoseFaves) => void;
  youCount: number;
  members: CrewMember[];
  status: string | null;
}) {
  return (
    <>
      <div class="whose-faves" role="group" aria-label="Whose favourites">
        <button
          type="button"
          class="whose-chip"
          aria-pressed={value === 'all'}
          onClick={() => onSelect('all')}
        >
          Everyone
        </button>
        <button
          type="button"
          class="whose-chip"
          aria-pressed={value === 'you'}
          onClick={() => onSelect('you')}
        >
          <span class="whose-star" aria-hidden="true">
            ★
          </span>
          You{youCount ? ` (${youCount})` : ''}
        </button>
        {members.map((m) => (
          <button
            key={m.userId}
            type="button"
            class="whose-chip"
            aria-pressed={value === m.userId}
            onClick={() => onSelect(m.userId)}
          >
            <Avatar userId={m.userId} name={m.displayName} size="sm" />
            <span class="whose-name">{m.displayName}</span>
          </button>
        ))}
      </div>
      {status !== null && (
        <p class="filter-status" role="status">
          {status}
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
  return (
    <button type="button" class="fab" onClick={onClick}>
      Jump to now
    </button>
  );
}

/** All-days results, shared by search and the whose-favourites filter. */
function AllDaysResults({
  days,
  occurrences,
  going,
  today,
  nowDate,
  nowSepRef,
  filtered,
  emptyMessage,
}: {
  days: { day: string; startISO: string }[];
  occurrences: Occurrence[];
  going: Map<string, CrewMember[]>;
  today: string;
  nowDate: Date;
  nowSepRef: Ref<HTMLDivElement>;
  filtered: boolean;
  emptyMessage: string;
}) {
  const n = occurrences.length;

  if (n === 0) {
    // A live region on every empty state — the message (esp. an actionable hint)
    // must be announced, not just the picker's status count.
    return (
      <p class="results-summary" role="status">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      {!filtered && (
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
            going={going}
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
  going,
  day,
  today,
  nowDate,
  nowSepRef,
  headingLevel,
}: {
  occurrences: Occurrence[];
  going: Map<string, CrewMember[]>;
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
              <EventRow key={occ.id} occ={occ} going={going.get(occ.id)} />
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
      tabIndex={-1}
      class="now-sep"
      role="separator"
      aria-label={`Now, ${formatTime(nowDate.toISOString())}`}
    >
      Now · {formatTime(nowDate.toISOString())}
    </div>
  );
}

/** The "also going" row — non-ghost crew (minus you) who starred this session. */
function GoingRow({ members }: { members: CrewMember[] }) {
  return (
    <div class="going">
      <span class="going-label">Also going</span>
      <ul class="going-list" aria-label="Crew also going">
        {members.map((m) => (
          <li key={m.userId} class="going-chip">
            <Avatar userId={m.userId} name={m.displayName} size="sm" />
            <span class="going-name">{m.displayName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventRow({ occ, going }: { occ: Occurrence; going: CrewMember[] | undefined }) {
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

  // Host/presenter line (only cons whose feed carries hosts, e.g. ToS).
  const hosts = occ.hosts?.length ? (
    <span class="hosts">Hosted by {occ.hosts.join(', ')}</span>
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
              {hosts}
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
            {hosts}
          </div>
        )}
        {open && hasDesc && (
          <div id={panelId} class="desc">
            <Markdown text={occ.abstract} />
          </div>
        )}
        {going && going.length > 0 && <GoingRow members={going} />}
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
