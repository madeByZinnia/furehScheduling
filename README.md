# Fur-Eh 2026 Crew

A shared schedule for the **Fur-Eh 2026** furry convention (Edmonton, July 16–19 2026),
shipping as a Telegram Mini App + plain web app. **Accessibility is a hard requirement** —
the primary user is legally blind and browses at near-max magnification.

Stack: **Vite + Preact + TypeScript (strict)**, plain CSS, no date library, on a single Cloudflare
Worker + Durable Objects backend. See **`docs/ARCHITECTURE.md`** for the architecture, interfaces,
and data flow; run `bd list` / `bd show <id>` for the milestone plan and design rationale.

## Run it (manual testing)

```bash
npm install          # first time only
npm run dev          # dev server with hot reload → http://localhost:5173
```

Open the printed URL. Browse the schedule, star locally, and explore the Map/Crew/Me tabs (crew
sync + the bot digest require Telegram; see `docs/ARCHITECTURE.md`). To test the production bundle
instead:

```bash
npm run build        # typecheck + bundle into dist/
npm run preview      # serve dist/ → http://localhost:4173
```

### Things worth clicking

- **Day tabs** — Thu/Fri/Sat/Sun (always America/Edmonton, even if your machine isn't).
- **Search** — matches title, room, track, and abstract. There is no speaker data in the feed.
- **Star (☆ / ★)** — per *occurrence*. Starring one Headless Lounge slot must **not** star the
  other three days. Stars persist in `localStorage`; the header count updates live.
- **Display settings** — Text size (S·M·L·XL·XXL, default M) and Theme (System/Dark/Light), each
  persists across reload.

### Time travel — test anything time-based

The con hasn't happened, so a `?now=` query param overrides "now". Everything time-based (the
**"NOW" separator**, and later the map/digest) behaves as if it were that instant:

```
http://localhost:5173/?now=2026-07-17T13:05:00-06:00
```

The header shows a ⏱ badge and the day tab / now-separator jump to that moment. Try a time between
two sessions to see the separator land between them.

### Accessibility spot-checks

- Bump **Text size → XXL** and confirm every screen scales and nothing scrolls sideways.
- Zoom the browser to **400%** (Ctrl/Cmd +) — content should reflow with **no horizontal scroll**.
- Tab through with the keyboard — every control shows a visible gold focus ring, 44px+ targets.
- Toggle **Theme** — text stays high-contrast in both light and dark.

## Refresh the schedule data

The app ships a baked `src/data/schedule.json`. Regenerate it from the live pretalx feed:

```bash
npm run schedule     # fetch + expand + assert, then write src/data/schedule.json
```

It joins the pretalx feed, expands each submission into its individual time slots (208-ish slots
vs ~177 codes — a repeating session is one code scheduled several times), and gates the write on
sanity assertions (4 days, Registration→5, CZKVLN→4, no giant shrink). If assertions fail it leaves
the committed file untouched. Override the source with `PRETALX_SCHEDULE_URL=...` or `--fixture <path>`.

## Quality gates

```bash
npm test             # Vitest unit + property tests (fast-check)
npm run test:watch   # watch mode
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # ESLint — fails on correctness errors only, not style/size warnings
npm run format       # Prettier --write
npm run test:workers # workerd-runtime tests (for the later DO/alarm backend)
```

## Layout

```
src/app/      UI: App (4-tab shell), schedule/, map/, events/, nav/, stores, crewSync, ics, a11y.css
src/data/     schedule types + occurrence expansion (expand.ts), branded ids, baked schedule.json,
              map geo.ts + basemap/buildings/rooms.json
src/worker/   Worker entry (index.ts), Crew Durable Object (crew-do.ts), telegram, digest
scripts/      fetch-schedule.ts (run via npm run schedule)
test/workers/ workerd-pool tests (DO/alarm, digest, webhook, roster, custom events)
```

Task tracking uses **bd (beads)**, not markdown TODOs — run `bd ready` for available work.
