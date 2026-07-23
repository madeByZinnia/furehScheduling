# Fur-Eh 2026 Crew — Architecture

Current-state architecture of the app: what it is, how the pieces fit, the key
interfaces, how data flows through them, and the handful of invariants worth
knowing before you touch the tricky parts.

> Task tracking is **beads** (`bd`), not markdown TODOs. The milestone plan and
> its design rationale live in the bead backlog (`bd list`, `bd show <id>`); run
> `bd ready` for available work. This document describes the code as it stands;
> the beads describe what is planned and why.

---

## What it is

A shared schedule for the **Fur-Eh 2026** furry convention (Wyndham + Delta
hotels, Edmonton, **July 16–19 2026**), shipping as a **Telegram Mini App and a
plain web app** from a single Cloudflare Worker. A crew of friends compares
picks, sees where everyone is on a drawn vector floor map, adds unofficial
events (room parties, dinners), and exports their stars as a universal `.ics`.

**Accessibility is a hard architectural constraint, not polish.** The primary
user is legally blind and browses at near-maximum magnification. This single
requirement drives major decisions:

- The map is **drawn vector SVG, never raster** — infinitely magnifiable, our own
  text labels, AAA contrast by construction.
- `rem` units throughout; an in-app text-size control (Telegram's webview does
  not forward the OS text setting, so we guarantee scaling ourselves).
- **AAA 7:1 contrast** in both themes; **opacity never carries meaning** (state is
  encoded with shape + text); 44px touch targets; reflow at 400% with no
  horizontal scroll (the map alone is exempt — a floor plan is irreducibly 2D,
  which is why it ships a text List view as a peer).

---

## Tech stack

| Layer   | Choice |
|---------|--------|
| Client  | **Vite + Preact + TypeScript (strict)**, plain CSS, **no date library** (`Intl.DateTimeFormat` — no DST during the con) |
| Backend | **One Cloudflare Worker** + **Durable Objects** (one `Crew` per group chat, SQLite-backed, each with its own Alarm) + Workers Static Assets |
| Tests   | **Vitest** + **fast-check** (property-based) + **`@cloudflare/vitest-pool-workers`** (DO/alarm tests in the real `workerd` runtime) |
| Deploy  | Single `wrangler deploy`; Workers Paid plan |

Strictness is deliberate: `tsconfig` has `strict`, `noUncheckedIndexedAccess`,
`noFallthroughCasesInSwitch`. ESLint (`recommendedTypeChecked`) makes
**correctness** rules errors that block CI (`no-floating-promises`,
`no-misused-promises`, `switch-exhaustiveness-check`, `no-unnecessary-condition`,
`eqeqeq`) while size/complexity rules are non-blocking warnings. Prettier owns
formatting. IDs are **branded types** (`OccurrenceId` vs `ItemCode`) so the
compiler catches the occurrence bug (below).

---

## Big picture

```
                pretalx feeds
                     │  (build time: scripts/fetch-schedule.ts)
                     ▼
        src/data/schedule.json  ── baked, committed, single source of truth
                     │ imported directly by:
   ┌─────────────────┼──────────────────┬───────────────┬──────────────┐
   ▼                 ▼                  ▼               ▼              ▼
ScheduleView       MapView        worker/digest.ts   crew-do.ts    ics / import
(Schedule tab)    (Map tab)       (bot digest)       (DO roster)   (.ics export)

  ── client shared state (framework-light) ──
  store.ts: createStore<T> + useStore/useStoreSelector
    stars.ts · settings.ts · ghost.ts · profile.ts   (each persists to localStorage)

  ── client ⇄ worker (Telegram Mini App only; no-op on plain web) ──
  crewSync.ts ──POST /api/sync (debounced 800ms)──▶ worker/index.ts ──RPC──▶ Crew DO
              ──POST /api/roster───────────────────▶
  events/*    ──POST /api/events/{create,edit,cancel,star,list}──▶

  ── the bot loop (no incoming request) ──
  Crew DO self-scheduling 5-min Alarm ──▶ editMessageText / pin the "Happening Now" digest
```

One `wrangler deploy` serves the SPA from `./dist/` **and** runs the Worker.
`wrangler.jsonc` sets `not_found_handling: "single-page-application"` for the SPA
fallback, but `run_worker_first: ["/api/*", "/telegram/*"]` routes API + bot paths
to the Worker first so the fallback doesn't swallow them. First smoke test after
deploy: `GET /api/health` returns JSON, not HTML.

---

## Schedule data pipeline (build-time, one direction)

`scripts/fetch-schedule.ts` (`npm run schedule`) fetches both pretalx endpoints,
joins them on `code`, expands occurrences, and writes the committed
`src/data/schedule.json`. The write is **gated on sanity assertions** (4 days,
`Registration` → 5 occurrences, `CZKVLN` → 4, no giant shrink); if they fail the
committed file is left untouched.

**The occurrence bug — the one that would have shipped silently.** A pretalx
`code` identifies a *submission*, not a time slot: the feed schedules a repeating
session as one submission with several slots, so ~208 slots collapse to ~178
unique codes. If stars / `.ics` / the map key on the code (or worse, a slot
index) instead of the slot, four days of Headless Lounge fuse into one event and
a single cancellation renumbers everything after it.

`src/data/expand.ts` contains the fix and is **pure** (no I/O) so property tests
hammer it directly. The universal record:

```ts
interface Occurrence {
  id: OccurrenceId;   // `${code}@${startISO}` — keyed on code+start, NEVER index
  code: ItemCode;     // branded, distinct type from OccurrenceId
  title: string;
  abstract: string;
  track: string | null;
  room: string | null;   // e.g. "Wyndham - Terrace 5" — the join key for map + roster
  start: string; end: string;
  day: string;        // YYYY-MM-DD in America/Edmonton, regardless of device tz
}
```

- IDs keyed on `code + start` are **stable under arbitrary slot removal/reorder**
  (a property test asserts this).
- Localized strings arrive as `"Main Stage"` **or** `{ "en": "Main Stage" }` —
  `normalizeString` collapses them, or you get `[object Object]`.
- **No speaker data** in the feed — search covers title/abstract/track/room only.
- Code-less "Overflow Seating" slots get a synthetic `id:<start>#<room>` so
  same-instant slots in different rooms stay distinct.

The Worker *may* later serve a live `GET /api/schedule` (re-fetch + edge-cache);
today the client uses the baked JSON. (Tracked in bead `qn7`.)

---

## Client

A bottom-nav SPA with **four tabs** (`src/app/App.tsx`): **Schedule**, **Map**,
**Crew**, **Me**. Only the active tab is mounted (keeps a tab's `position:fixed`
FAB from bleeding onto others; each tab owns its ephemeral state — no router).
A `?now=` query param overrides "now" everywhere time-based (`now.ts`,
`useNow.ts`) — built first, because the con hasn't happened yet and it's the only
way to test the digest, the now-separator, and ambient-venue logic.

### Shared state — `store.ts`

The whole state layer is one tiny observable, no framework state library:

```ts
interface Store<T> { get; set; update; subscribe }         // createStore<T>(initial)
useStore(store): T                                          // re-render on change
useStoreSelector(store, selector, isEqual?): S             // re-render on a slice only
```

Each concern is a **module-level store that also persists to `localStorage`**:
`stars.ts` (per-occurrence stars), `settings.ts` (theme + text size), `ghost.ts`
(the ghost-mode boolean), `profile.ts` (custom display name). Components
subscribe; nothing is threaded through props. **Stars are the single source of
truth for "where am I going"** — the Map reuses the same `useStars()` store to
compute its overlay.

- **Text size**: five discrete stops `S · M · L · XL · XXL`, default **M**,
  applied as `data-text-size` on `<html>` and keyed by `a11y.css`. (There is no
  "16px floor / A/A+/A++" — that was an earlier design that got revised to these
  stops with headroom above.)
- **Theme**: `system | dark | light`, applied as `data-theme` on `<html>`.

### Map (`src/app/map/`, `src/data/geo.ts`)

Site → Building → Floor, drawn in **real-world metres**. The unlock is one shared
projection:

- **`geo.ts`** — a single pure `project(lat,lon) → {x,y} metres` (and
  `unproject`) about a frozen `CON_ORIGIN` (midpoint of the two hotel centroids),
  equirectangular on a local tangent plane. Everything spatial — the baked OSM
  basemap, every traced room polygon, and (future) the live GPS dot — goes
  through *this* function, so "lat/lng → screen position is exact **by
  construction**" rather than by fitting a transform to art. The SVG coordinate
  space literally *is* metres on the ground; `x` is +east, `y` is +south (SVG-down)
  so it drops straight into a `viewBox` with no per-consumer y-flip.
- **`geometry.ts`** loads `basemap.json` (baked OSM outdoor context — streets,
  parking, POIs; **zero runtime tiles/requests**; ODbL attribution shown),
  `buildings.json` (Wyndham/Delta OSM ways + floor metadata), and `rooms.json`
  (building-normalized room rects/polygons affine-fit into each building's real
  OSM footprint). Exposes `buildings()`, `floorRooms()`, `locateScheduleRoom()`,
  `pois`, `streetLabels()`, `RoomShape`/`RoomKind`, etc.
- **`MapView.tsx`** renders the selector, pan/zoom (`usePanZoom.ts`), the basemap,
  the drawn floor (fills → interior walls → outlines with door-gaps → facility
  icons → labels), and the **your-stars overlay**: your starred occurrences →
  their room strings → `locateScheduleRoom` → highlighted rooms + a per-building
  star badge. This is entirely **client-side** off your own stars — no backend.

**M4 status:** shipped to `main` — the Site/Building/Floor selector, pan/zoom,
OSM basemap, star overlay, and traced **Wyndham Main + Delta Main** floors.
Remaining (tracked in `aau.*`): the underground/2nd floors (their `controlPoints`
arrays are empty; georeferenced via shared elevator/stairs control points), the
alphabetical text **List view** peer, the build-gate room check, and marker-fusion
tests. `rooms.json` is still `"provisional": true` (traced, not survey-verified);
`locationUnknown` is empty (Glacier resolved — it's on Delta 2nd); `offMap` is
`Delta - Downtown` (off-site GoH dinner) + `Delta - Parking Garage` (Motorama).

---

## Client ⇄ Worker sync (`src/app/crewSync.ts` ↔ `src/worker/index.ts`)

The client half pushes this device's stars + ghost + display name and pulls the
whole crew roster. **On plain web (non-Telegram) everything is a no-op** — there
is no signed identity to sync under, so the local stars store stays solo. **No
network failure ever throws to the UI.**

```
startAutoSync()  ── subscribes stars+ghost+name, debounce 800ms ──▶ POST /api/sync
buildSyncBody() (pure) → { initData, ghost, stars, displayName? }   (NEVER a chatId)
fetchRoster()  ──────────────────────────────────────────────────▶ POST /api/roster
                                                                     → RosterResult:
                                                                       'non-telegram' | 'ok'{roster} | 'error'
```

- **The security seam.** The client sends the raw **signed `initData`** and *never*
  a `chatId`. The Worker's `resolveCrew()` verifies the HMAC and **derives** the
  crew from the signed data — a client-supplied chat id is forgeable and must not
  select a crew. `initData` is sensitive: never logged, never echoed.
- Roster types (`RosterEntry` / `RosterPlan`) are **mirrored by hand** on both
  sides; worker code is deliberately never imported into the SPA bundle.
- `RosterResult` keeps three outcomes distinct (`non-telegram` / `ok` / `error`)
  so the UI can tell "open in Telegram" apart from a real failure + Retry, and an
  empty roster (`ok`, `[]`) apart from both.
- After a successful **leave**, `suspendAutoSync()` stops all further pushes for
  the session — otherwise a later star would re-`syncMember` and silently undo the
  privacy action.

### Worker (`src/worker/index.ts`) — thin router + auth gate

Every crew endpoint goes through `resolveCrew()`: read the body once, verify
`initData`, derive the crew, and return an `env.CREW.getByName(crewId)` stub. Two
launch shapes yield the crew with different trust: an **attachment-menu launch**
carries a signed `chat.id` (trusted, no membership call); a **direct-link launch**
carries a user-chosen `start_param` (untrusted → `getChatMember` must confirm the
acting user is an active member, and it **fails closed** — 403 — on a non-member
or any error).

| Route | Purpose |
|-------|---------|
| `GET  /api/health` | JSON liveness (the `run_worker_first` smoke test) |
| `POST /api/resolve` | verify `initData`, mint an access code, return the user |
| `POST /api/sync` | upsert the acting user's roster row + stars |
| `POST /api/roster` | the crew roster (ghost plans already redacted server-side) |
| `POST /api/leave` | remove the acting user (optionally soft-cancel own events) |
| `POST /api/events/{create,edit,cancel,star,list}` | custom events |
| `POST /telegram/webhook` | bot updates; fail-closed on missing secret; fast 200 + `waitUntil` |
| `POST /telegram/{setup,trigger}` | bearer-gated admin (register webhook; force a digest, honors `?now=`) |

The user id and display name always come from the **verified** `initData`, never
the body, so a client can never act on someone else's behalf. Body fields are
sanitized (stars capped/length-bounded, display name stripped of control chars).
`ghost` and `stars` require an **explicit** value — a missing `ghost` must not
un-ghost someone, and a missing `stars` must not wipe an existing set.

---

## The Durable Object (`src/worker/crew-do.ts`)

One `Crew` DO **per Telegram group chat**, routed by `idFromName(crewId)`. It
owns all crew state in **SQLite** (chosen over KV deliberately — see below):

| Table | Holds |
|-------|-------|
| `crew_config` | chat id, pinned message id, is-admin (one row) |
| `digest_posts` | dedupe ledger (PRIMARY KEY = 5-min bucket) |
| `crew_member` | one row per opted-in member; `ghost` is the load-bearing flag |
| `member_star` | a member's starred occurrences (composite PK, per-member) |
| `custom_event` | standalone unofficial events, keyed by `event_id` |
| `custom_event_star` | who starred which custom event |

RPC surface: `configure` / `deactivate` / `setAdmin`, `syncMember` / `getRoster`
/ `leaveCrew`, `createEvent` / `editEvent` / `cancelEvent` / `starEvent` /
`unstarEvent` / `listEvents`, `postDigest`, `alarm`.

**Why SQLite, not KV** (`new_sqlite_classes` in the migration — **not**
`new_classes`, which makes KV-backed DOs that fail on new accounts and can't be
converted once deployed): live location is a hot-key rewrite pattern that KV
rate-limits to 1 write/sec, and KV is eventually consistent (a *live* feature on a
minute-stale store would be dishonest). A DO gives strongly-consistent serialized
writes and a natural home for the alarm.

Invariants the code protects:
- **Ghost redaction is server-side.** `getRoster` never even reads a ghost
  member's stars — their plans become `[]` before anything hits the wire. Stars
  are still stored (flipping ghost off later reveals them).
- **Leave ≠ cancel.** Leaving is pure privacy: it removes only *your* rows and
  **never** destroys a room party others starred. Cancelling an event you own is a
  separate, explicit action; the "also cancel my events" option on leave defaults
  **off** (pre-ticking it would let a privacy action silently destroy other
  people's plans — the exact dark pattern the split prevents).
- **Cancel is soft.** `cancelled = 1`, never `DELETE`, so starrers keep seeing
  `[CANCELLED]` rather than the event silently vanishing.
- **Custom-event `location` is free text only** (e.g. "Rm 1412"). There is
  deliberately no coordinate/pin/lat-lng column anywhere — a hard product
  constraint. (The Map tab is read-only + star-driven; it is not tap-to-place.)
- `syncMember` and `leaveCrew` each run inside `transactionSync` so a member is
  never observed with a half-replaced star set.

---

## The alarm — why the DO schedules itself

The bot's headline feature is a **single pinned "Happening Now" message** in each
crew's Telegram group that stays current all weekend *without notifying anyone*
(Telegram message **edits fire no notification**). For that message to stay
current, something has to wake up every ~5 minutes, rebuild the digest text
(`worker/digest.ts:buildDigest`), and `editMessageText` it. **The alarm is that
heartbeat.**

The real question is *who triggers the recurring work*. A Worker is stateless and
only runs when hit by a request — and nobody hits it between digests. Two ways to
get a timer:

- **A global Cron Trigger** (rejected): a single cron would have to *enumerate
  every crew* to know who to update — but the design dropped KV, so **there is no
  crew registry to enumerate** (plus a 250-cron/account cap).
- **A per-object DO Alarm** (chosen): a Durable Object calls
  `ctx.storage.setAlarm(t)`, and the runtime later invokes that object's `alarm()`
  method **with no incoming request** — the object wakes *itself*. Each `Crew` DO
  is therefore a self-contained scheduler: `alarm()` re-arms itself 5 minutes out
  and posts/edits its own digest. No registry, scales per-crew, and alarms come
  with automatic retries.

That self-scheduling is why the handler looks fiddly — three DO-alarm facts it
must respect:

1. **Alarms are one-shot** — you must re-arm each time. It re-arms **at the start**
   of `alarm()`, so a mid-handler crash still leaves a future alarm pending
   (`setAlarm` overwrites, so exactly one is ever queued).
2. **Alarms are at-least-once (up to 6 retries)** — a naive retry would post a
   *second* pinned message. The first post claims its 5-minute bucket via
   `INSERT OR IGNORE INTO digest_posts`; a retry writes 0 rows and bails. Steady
   state just edits the existing pin, which is idempotent to repeat.
3. **Lifecycle** — `deactivate()` deletes the alarm when the bot is removed (else
   it fires failing Telegram calls forever); the planned 60-day self-delete +
   stale-location purge (bead `qn7.1`, since DO storage has **no TTL**) ride the
   same tick.

Pinning is retried every tick and is non-fatal: if the bot lacks admin rights the
digest still posts, and the moment an admin promotes it (`my_chat_member` update)
the next tick pins and switches to quiet-edit mode by itself. The initial pin
passes `disable_notification: true` (pinning otherwise fires a "X pinned a
message" service notification — the one thing that would break the "zero
notification" promise).

Ambient venues (25 sessions run > 6 h — Dealer's Den, Registration, the lounges)
are **not** panels: the digest keeps them out of the headline and puts them in an
"Also open" footer with their next open/close transition (bead `gz6.1`).

---

## Calendar — one universal static `.ics` (`src/app/ics.ts`, client-only)

One button, everyone gets the same file; the server never sees it. Static (a
snapshot of your stars), because a live `webcal://` subscription would privilege
Apple over Google. The RFC traps that silently make Apple Calendar import
*nothing*, handled and property-tested first:

- **Per-occurrence UIDs on `code`+start** (not index) — or four days of Headless
  Lounge collapse into one event.
- **Fold at 75 *octets* without splitting a UTF-8 sequence** (custom events
  contain emoji); escape `\ ; ,` and newlines; **CRLF**; UTC `Z` times, no
  `VTIMEZONE`; `DTSTAMP` on every event; `METHOD:PUBLISH`.
- `VALARM` only if the user opts into "remind me 10 minutes before" (default off —
  34 unsolicited alerts is awful).

---

## Repository layout

```
src/app/         UI. App (4-tab shell), schedule/, map/, events/, nav/,
                 stores (store, stars, settings, ghost, profile), crewSync,
                 ics, import/export, now/useNow (time-travel), a11y.css
src/data/        Schedule types + occurrence expansion (expand.ts), branded ids,
                 baked schedule.json; map geo.ts + basemap/buildings/rooms.json
src/worker/      Worker entry (index.ts), Crew Durable Object (crew-do.ts),
                 telegram.ts, digest.ts, now.ts, env.ts
scripts/         fetch-schedule.ts (npm run schedule), set-webhook.ts
test/workers/    workerd-pool tests (crew-do, digest, webhook, custom-events, roster, …)
docs/            this file; mockups/ (visual approximation, not ground truth)
```

## Commands

```bash
npm run dev          # Vite dev server + hot reload
npm run build        # tsc --noEmit + vite build → dist/
npm test             # Vitest unit + property tests (fast-check)
npm run test:workers # DO/alarm tests in the real workerd runtime
npm run typecheck    # tsc across app + worker + workers-test projects
npm run lint         # ESLint (correctness errors block; size/style warn)
npm run schedule     # refresh src/data/schedule.json from the live pretalx feed
npm run deploy       # wrangler deploy (Worker + DO + static assets, one shot)
```

## Milestone status (see beads for detail)

Done: **M0** (scaffold + schedule pipeline), **M1** (static SPA: browse/search/
star/import/`.ics`/a11y), the backend + Telegram de-risk spike, crew roster +
stars sync (ghost-aware), custom events (create/edit/cancel/star), display name,
and **M4** partially (Map tab: selector, basemap, star overlay, Wyndham/Delta main
floors). In flight / pending: **M3** bot digest polish incl. ambient rule
(`gz6.1`), **M2** remainder (`/api/schedule`, expiry `qn7.1`, consent `qn7.2`),
**M4** remainder (`aau.1/.5/.6/.7`, remaining floors), **M5** (`bgx.4/.5`), **M6**
live location (`5g8`), **M7** theme + privacy sweep (`x8s`).
