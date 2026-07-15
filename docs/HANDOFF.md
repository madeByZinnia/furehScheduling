# Handoff — First Vertical Slice (M0 + M1)

**Status:** planning locked, no application code written yet. This doc hands off the **first vertical
slice** for implementation. Read it, then work the beads issues in the order below.

## What this project is (30 seconds)

A shared schedule for the **Fur-Eh 2026** furry convention (Wyndham + Delta hotels, Edmonton, **July
16–19 2026**), shipping as a **Telegram Mini App + plain web app** on one Cloudflare Worker. It lets a
group of friends compare picks, see where everyone is on a drawn vector map, add unofficial events,
and export stars as a universal `.ics`. **Accessibility is a hard requirement** — the primary user is
legally blind and browses at near-max magnification.

Full context lives in two plans (both in this repo):
- **`docs/plan-master.md`** — architecture, stack, data facts, the whole M0–M7 milestone plan.
- **`docs/plan-revisions.md`** — design revisions from a round of mockup feedback (text-size control,
  map interaction model, corrected rooms, etc.). **Where the two disagree, the revisions win.**

Supporting artifacts:
- **`docs/mockups/furehscreens-v2.html`** — current all-screens mockup (open in a browser; toggle
  light/dark top-right). A *visual approximation*, not ground truth — real data/geometry come from the
  feed and the QRG.
- **`static/FUREH2026_HOOM_QRG_WEB.pdf`** — the **corrected** Quick Reference Guide (authoritative
  room geometry). Only needed for the map milestone (M4), not this slice.

## The slice: what "done" looks like

**Milestones M0 + M1 — all solo value, no backend.** When this slice is done you have a static SPA
that **beats the official schedule site and puts your stars in your phone's calendar**, with the
accessibility baseline built in. Per the master plan: *"If everything else fails, this ships."*

Explicitly **out of scope** for this slice: the Worker/Durable Object backend (M2), the bot digest
(M3), the map (M4), custom events (M5), live location (M6), theme polish (M7). Don't build them yet.

## Work order (beads issues)

Do them in this sequence. `bd show <id>` for full detail; `bd update <id> --claim` when you start;
`bd close <id>` when done.

| # | Issue | Why this order |
|---|---|---|
| 1 | `fureh-schedules-zhy.2` — Scaffold (Vite + Preact, **TypeScript** strict, plain CSS, no date lib) | Nothing runs without it |
| 2 | `fureh-schedules-zhy.1` — **Time-travel `?now=...` override — build FIRST** | 5 lines; the con hasn't happened, so every time-based view needs this to be testable |
| 3 | `fureh-schedules-zhy.3` — `fetch-schedule.ts` (run via `tsx`): pretalx join + **occurrence expansion** + assertions → `src/data/schedule.json` | Everything downstream depends on this data shape |
| 4 | `fureh-schedules-4cz.4` — **a11y baseline** (`src/app/a11y.css`), imported first | Must be in from the first UI commit, not retrofitted |
| 5 | `fureh-schedules-4cz.5` — Schedule tab: day tabs, time grouping, search | The thing that beats the official site |
| 6 | `fureh-schedules-4cz.6` — Local stars, **per-occurrence**, localStorage | Pre-backend star store |
| 7 | `fureh-schedules-4cz.1` — **[flag]** `ics.js` fold/escape/UID — **write & test these functions FIRST** | Unfolded/unescaped lines make Apple Calendar silently import nothing |
| 8 | `fureh-schedules-4cz.7` — `.ics` export UI (opt-in VALARM, default off) | Uses #7 |
| 9 | `fureh-schedules-4cz.8` — Paste-import from fur-eh favourites | Shortcut for existing users |
| 10 | `fureh-schedules-4cz.2` — Text-size **discrete slider** + split Display (Text size / Theme), lower default | a11y revision (see below) |
| 11 | `fureh-schedules-4cz.3` — Remove the meaningless gold header label | Polish |

## Testing (set up in the scaffold, then write alongside each piece)

Stand up the harness in step 1: **Vitest + fast-check + `@cloudflare/vitest-pool-workers`**
(the last one matters later for DO/alarm tests in the real `workerd` runtime). This app is
invariant-dense, so **property-based tests carry real weight** — see the master plan's **Testing**
section for the full list. Two land inside this first slice:

- **`fetch-schedule.ts`** (`fureh-schedules-zhy.3.1`): property test that occurrence ids are **stable
  under arbitrary slot removal/reordering**, plus the example asserts (208/178/4, Registration→5,
  CZKVLN→4).
- **`ics.ts`** (`fureh-schedules-4cz.1.1`): property tests for `unfold(fold(s))===s`, the **75-octet
  bound with no split UTF-8 sequence**, escape round-trips, and UID uniqueness — write these *before*
  the export UI, they're the RFC trap that silently breaks Apple Calendar.

## Gotchas that will bite you (from the plans)

- **Stack is TypeScript (strict).** Vite + Preact + TS, plain CSS, `@cloudflare/workers-types` for
  the later Worker/DO. **Brand `OccurrenceId` vs `ItemCode`** and model the marker-fusion states + DO
  storage records as **discriminated unions** — the compiler, not just runtime asserts, guards the
  invariants below. Scripts run in TS via `tsx`. (No date library — `Intl.DateTimeFormat` suffices.)
- **Occurrence expansion is the silent bug.** A pretalx `code` is a *submission*, not a slot: **208
  slots collapse to 178 unique codes**. Key occurrence ids on **`code` + start timestamp**, never on
  an index (a cancelled slot renumbers everything after it). In TS, make `OccurrenceId` a **branded
  type** so passing an item code where an occurrence id is expected is a *compile* error. Stars,
  `.ics`, and the map all break without this. Assertions: 208 slots / 178 codes / 4 days; `Registration` → **5** occurrences;
  `CZKVLN` → **4**; ids **stable across two runs** even if a slot is removed.
- **No speaker data.** `persons: []` / `speakers: []` across the feed. Search covers **title,
  abstract, track, room** only. Don't promise speaker search.
- **Localized strings.** Room/track names arrive as `"Main Stage"` *or* `{"en":"Main Stage"}` —
  normalize or you get `[object Object]`.
- **All day-grouping is `America/Edmonton`**, regardless of device timezone (travellers are on
  Pacific/Central). Use `Intl.DateTimeFormat`; no DST during the con, so no date library needed.
- **`.ics` correctness (do #7 before #8):** per-occurrence UIDs on `code`+start; fold at **75 octets**
  without splitting a UTF-8 sequence; escape `\ ; ,` and newlines; UTC `Z` times, no `VTIMEZONE`;
  **CRLF**; `DTSTAMP` on every event; `METHOD:PUBLISH`; `VALARM` only if the user opted in.
- **Text size — the revision that matters here:** Telegram does **not** reliably forward the OS text
  setting into its webview (iOS WKWebView ignores Dynamic Type; the WebApp API has no font field). So
  the in-app control is load-bearing. Build it as a **discrete slider** (fixed stops S/M/L/XL/XXL →
  root `font-size`), **lower default (~M)**, range above the old A++, persisted; **split** it from the
  Dark/Light theme toggle into its own labelled section. `rem` everywhere so it scales from root.
- **4 sessions have no `code`** (Overflow Seating) — synthesize `id:<n>`.

## Verification (end-to-end, not just unit)

1. `npm run schedule` (or equivalent) asserts 208/178/4, `Registration`→5, `CZKVLN`→4, and **stable
   ids across two runs** with a slot removed.
2. **Accessibility at real magnification, not simulated:** reflow at 400% with **no horizontal
   scroll**; the text-size slider snaps to stops, persists across reload, scales every screen; contrast
   measured **≥7:1** in both themes; every control 44px+ and reachable.
3. **Import round-trip:** paste your real favourites; matched count equals your star count on the
   official site (regex `\b[A-Z0-9]{6}\b` **intersected with known codes** so over-matching is
   harmless).
4. **`.ics`:** RFC 5545 validator, then **import on a real phone**. The longest abstract folds without
   corrupting emoji; a Headless Lounge appears as **4 separate events**, not 1.
5. **Time-travel:** `?now=2026-07-18T13:05:00-06:00` shifts the "now" separator and any time-based UI.

## Housekeeping

- **Task tracking = beads only** (`bd`), never TodoWrite/markdown TODOs. Create issues for anything you
  discover; `bd ready` for what's unblocked.
- **Git policy is conservative** (see CLAUDE.md): don't commit/push unless asked. As of this handoff,
  `docs/`, `static/`, and `.beads/issues.jsonl` are **untracked/uncommitted** — a maintainer should
  review and commit them. No git remote is configured; beads is local-only.
- **The canonical plans live in `~/.claude/plans/`** on the author's machine; `docs/plan-*.md` are
  in-repo snapshots for agents. If you revise the design, update the in-repo copies (they may drift).
- Deferred but noted: the map milestone (M4) has been expanded with an OSM outdoor basemap, a shared
  building/floor selector (no SITE pill, drives Map + List), an alphabetical text List view, and
  underground-floor georeferencing via shared elevator/stairs control points — see `aau.2`–`aau.6` and
  `docs/plan-revisions.md`.
