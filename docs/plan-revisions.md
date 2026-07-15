# Fur-Eh 2026 Crew — design revisions from mockup feedback

## Context

The project is still **greenfield**: no application code exists yet — only the master plan
(`and-i-ve-gone-through-glimmering-dahl.md`) and a 17-issue beads backlog encoding it. The one
implementation artifact so far is a static HTML mockup of all screens
(`C:\Users\QCeplis\Downloads\furehscreens.html`).

This document is a **revision layer** on top of the master plan. It captures the design changes
from a round of mockup feedback, resolves four questions that needed research or a decision, and
lists the concrete screen-by-screen edits to make before M1 code is written. Applying it now is
cheap; applying it after the SPA exists is not. Nothing here contradicts the master plan's
architecture — it refines the UI and closes gaps in the crew-creation, map, and settings flows.

**Decisions made this round (user):**
- Crew creation: **guided group-add now, standalone-crew creation deferred** as a possible follow-up.
- Map List view ordering: **alphabetical**, with crew/on-now shown as badges inside each row.
- OSM outdoor basemap: **folded into M4** (the map ships with real outdoor context).

---

## Research resolutions

### 1. Does Telegram forward OS text scaling into the Mini App? — No. Keep the in-app control.

Confirmed against Telegram + WebView docs:
- The WebApp API (`core.telegram.org/bots/webapps`) exposes **only colour** `themeParams` — **no
  font-size / text-scale field**. We cannot detect the user's OS text preference at all.
- **iOS `WKWebView` ignores Dynamic Type** unless the page opts in *and* the host app rewires a
  reload on `UIContentSizeCategory` change — which Telegram does not document doing. Treat iOS OS
  scaling as **not propagating**.
- Android WebView *usually* honours the system font scale, but Telegram documents nothing and can
  override it.

**Conclusion:** the in-app text-size control is **load-bearing, not over-engineering** — it is the
only cross-platform guarantee for the primary (legally blind) user. But the feedback's other points
stand and are adopted below (smaller default baseline, discrete slider, split the Display section).
Optionally add `:root{font:-apple-system-body}` as a *progressive enhancement* for iOS, never a
dependency.

### 2. Telegram bot-message HTML is a tiny inline-only whitelist — constrains the digest only.

`sendMessage parse_mode=HTML` supports **only**: `<b>/<strong>`, `<i>/<em>`, `<u>/<ins>`,
`<s>/<strike>/<del>`, `<a>`, `<code>`, `<pre>` (+ `class="language-…"`), `<blockquote>`
(+ `expandable`), `<tg-spoiler>`, `<tg-emoji>`. **No `<div>`, `<table>`, `<p>`, `<img>`, `<ul>`, no
CSS, no JS.** Only `&lt; &gt; &amp; &quot;` named entities.

This governs **only the bot's pinned digest**. The digest must be designed within that subset: line
breaks + `<b>` for structure, `<code>` for aligned times, `<a>` for the map button — no columns or
tables. The mockup's rich digest layout is a *visual approximation*; the real bot message is
plain-text-with-inline-formatting.

### 3. Bot pinned message → HTML client: how the jump works. (Answers Val's "html in telegram".)

Two separate systems, and this is the source of the confusion:
- The **pinned digest** is a Telegram *message* — limited inline HTML only (above).
- The **Mini App** is a full web page (arbitrary HTML/CSS/JS) rendered in Telegram's in-app
  webview. **This is the "html in telegram" Val meant** — Mini Apps, not messages.

The jump: the digest carries an **inline `web_app` button** (or a `t.me/<bot>/<app>?startapp=<crewId>`
deep link) — the mockup's "🗺 Open the map ›". Tapping it launches the Mini App webview with the
crewId arriving inside signed `initData`. That is the entire bridge; nothing renders the full client
*inside* a message.

### 4. OSM outdoor basemap — real unlock, zero runtime requests, folded into M4.

The earlier rejection was specific to a *stylized raster* basemap. Since we now draw our own vector,
OSM geometry is just more baked paths:
- Build step `scripts/build-basemap.mjs`: **Overpass API** (bbox ~250 m around both hotels) → OSM
  ways/relations for `highway=*` (incl. Gateway Blvd, footways/paths), `amenity=parking`,
  `building=*` nearby, `railway=light_rail`/LRT platforms → **`osmtogeojson`** → project → SVG paths
  → **commit the generated SVG**. Runtime loads a static asset; **no Overpass/tile/CDN calls at
  runtime** — the zero-third-party-request rule holds.
- **One shared transform** for hotels *and* OSM geometry — local ENU tangent plane anchored at the
  midpoint of the two hotels: `x=(lon−lon0)·cos(lat0)·111320`, `y=(lat−lat0)·110540`, `svgY=−y`.
  Sub-mm error over 200 m, and because the runtime GPS dot uses the *same* transform, dots land
  exactly on the baked streets. **Do not** use raw Web Mercator metres without the `cos(lat0)` term
  (~1.68× east-west stretch at Edmonton's latitude).
- **Licensing:** ODbL requires a visible, reachable **"© OpenStreetMap contributors"** credit (a
  corner label or info button on the Site view suffices — need not persist during pan/zoom). Keep the
  Overpass query + generated GeoJSON in the repo.
- OSM is **rendered outside the hotels at every zoom level**, including when "zoomed in" to a
  building/floor (the building interior is our own polygons; the surroundings stay OSM).

---

## Screen-by-screen revisions

### First open (consent) — explain ghost mode concretely
- Add 2–3 plain bullets stating what Ghost mode actually does:
  - Your crew sees **"no plans listed"** instead of your starred panels.
  - You **don't appear on the map** (no pin from stars or GPS).
  - **Stars, calendar/`.ics`, and the schedule still work for you** — it only changes what *others*
    see, never what you can do.
- Keep it one-time and non-blocking. The "join quietly" button stays; the bullets clarify the
  trade so nobody discovers visibility by accident.

### Me tab — split "Display", smaller default, discrete slider
The current single "Display" container mixing A/A+/A++ and theme is not accessible/clear. Replace with
**two labelled sections**:
- **Text size** — a **discrete slider** (fixed stops, snapping, not continuous): e.g. `S · M · L ·
  XL · XXL` mapping to root `font-size` values. **Lower the default baseline** (e.g. ~15–16px at
  "M") so we stop over-indexing on a large minimum for every user — the user who needs more just
  slides up, and the range extends higher than the mockup's A++. Persist the choice. `rem`-based CSS
  scales everything from the one root value.
- **Theme** — Dark / Light, its own labelled container.

### Custom events — free-text location first; add a way out
- **Reorder "Where":** the **free-text location field is primary and first**; "📍 Tap a spot on the
  map" becomes the **secondary** affordance below it. (Most custom events are "Rm 1412" / "the
  Delta lobby" — text is the fast path; map-pin is the extra.)
- Add an **explicit cancel/back control** (an `✕` or "Cancel" in the add-event header) so a misclick
  on the `+` FAB doesn't trap the user in the form. Discard without saving.

### Map — one shared building/floor selector, no SITE pill (revised)
A single control drives **both the Map and the List view** — the selection state, not a separate
toggle, decides what each shows. There is **no SITE pill**: an empty selection *is* the site.

- **Default load (site):** pills `[Wyndham] [Delta]`, both **unselected**. This is the site view.
- **Select a hotel** → it highlights and its **floors appear as pills**, with **Main auto-selected**
  (or the last floor viewed there). E.g. Wyndham → `[ Wyndham• · Main• · Parking 1 · Parking 2 ·
  Wyndham↔Delta ]`; Delta → `[ Delta• · Main• · 2nd Floor · →Wyndham ]`. The other hotel stays a
  jump target at the end.
- **Deselecting the floor** leaves the building selected with no floor — a real, reachable state.

The selection maps to each view as follows:

| Selection | Map view | List view |
|---|---|---|
| **None (site)** | OSM geometry for **both** hotels; no rooms | all rooms, both buildings, A→Z |
| **Building only** | zoom to that hotel's **OSM outline**; no rooms | all rooms in that building, A→Z |
| **Building + floor** | that floor's **drawn SVG floorplan** | rooms on that floor only, A→Z |

- Custom room geometry appears **only when a floor is selected**; building-only and site show OSM.
- **OSM basemap always renders outside the buildings**, at every zoom level.
- This **supersedes** the earlier "floor selector is Map-only" note — the selector is shared, because
  it now filters the List too. Header order per view: `[🗺 Map | ☰ List]` toggle → building/floor
  selector → canvas-or-list.
- Wyndham's Main / Parking 1 / Parking 2 are confirmed by the QRG as **three distinct floors of the
  one Wyndham building** — they are sibling floor pills, not separate stacks. (Prior open item
  closed.)

### Map — List view is a text view of the map, not the old Now tab
Rebuild List view so it is a **text-only rendering of the same spatial data**, not a schedule
re-scroll:
- **A header per room.** Ordered **alphabetically** (decision), stable A–Z.
- Under each room header: the **current panel** in that room (or "—" / ambient state), and **any crew
  present**, with their **signal noted** — GPS ring vs. star vs. GPS+star-agree, and staleness
  ("2m ago").
- Crew-present and on-now surface as **badges within the row**, not as the sort key (sort stays
  alphabetical for predictability / low cognitive load).
- No floor selector needed here — the list can span the building/site; floor scoping is a Map concern.

### Bot digest — ambient venues show their next state change
"Open all day" is wrong for Dealer's Den, Registration, etc. Replace the static label with the **next
transition**, computed from the schedule + current time:
- Before it opens: **"Dealer's Den: opens 9:00 AM"**.
- While open: **"Dealer's Den: closes 6:00 PM"**.
- This applies both in the **bot digest ambient footer** and anywhere the app labels ambient venues.
  Keep them out of the "on now" headline (the master plan's ambient-venue rule still holds) — but
  make the footer line truthful about hours.

### Header — remove the meaningless yellow "when" label
The gold top-right label (`SAT · 67`, `SITE`, `SAT 1:05`) duplicates the day tabs and the status-bar
clock and reads as noise. **Remove it.** If any of its data is genuinely useful (e.g. a filtered
result count on Schedule), fold that into the relevant control's own label rather than a floating gold
tag. Default: drop it.

### Crew page — restructure events + move the GoH alert
- **Remove the Guest-of-Honour-Dinner alert from the Crew page.** Attach it instead to the **GoH
  dinner event's own listing** in the schedule (moved-venue + address + maps link shown on that
  event).
- Rename the section **"Unofficial events" → "Your Events"**.
- **Drop the standalone "Cancel this event" card.** Instead:
  - The room-party card gets an **Edit** button → opens the **same creation screen** pre-filled.
  - On that edit screen, a **"Cancel event" button at the bottom**, gated by a **"You sure?"
    confirmation**. Real cancel semantics (shows `[CANCELLED]` to everyone who starred it), per the
    master plan's leave≠cancel rule.

---

## Room geometry — RESOLVED by the corrected QRG

The earlier "Glacier gap" and the "Banff / Lake Louise / Jasper" rooms were **artifacts of a wrong
source PDF**, not a parsing error. The user supplied the **corrected QRG** at
`static/FUREH2026_HOOM_QRG_WEB.pdf` — now the **authoritative geometry reference for `rooms.json`.**

Corrected facts:
- **Glacier Room is real and mapped** — Delta Second Floor, the large room between **Canmore
  (Headless Lounge)** and **Lethbridge**. The 13-session room is no longer a gap.
- **Banff / Lake Louise / Jasper do not exist** — they were on the bad PDF (and the mockup echoed
  them). Remove them entirely.
- **All 21 scheduled rooms now resolve to a real polygon** — the "one real gap" / "location-unknown"
  path is no longer needed for any current room.

Corrected room set to author into `rooms.json`:
- **Wyndham Main Floor:** Terrace 1 (Escape Room), Terrace 2 (Art Show), Terrace 3 (Art Lounge),
  Terrace 4 (Reg), Terrace 5 (Game Room), Lounge, Atrium Café, Atrium, Sushi Toshi, Front Desk;
  North/South/Main entrances.
- **Wyndham Parking 1:** Imperial (Second Stage). *(compass on this page fixes rotation)*
- **Wyndham Parking 2:** Jubilee (Main Stage), Gallery 1 (Headless Lounge), Gallery 2, Gallery 3
  (HIV Testing), Fitness Center & Pool, Con Ops; "To Parkade".
- **Delta Main Floor:** Grande Ballroom (Market of Meowria / Dealer's Den), Crystal Gallery (Market
  of Meowdor / 18+ Dealer's Den).
- **Delta Second Floor:** Fort McMurray, Red Deer, Medicine Hat, Edmonton, Canmore (Headless
  Lounge), **Glacier**, Lethbridge, Calgary, Grande Prairie.

The master plan's **build gate still stands** as a safety net: any *future* scheduled room that
doesn't resolve to a polygon or the off-map allow-list must fail the build (and degrade to "location
unknown" at runtime for a mid-con rename) — but today there is nothing in that state. Author geometry
by tracing the corrected PDF against the OSM footprints; **never** bake the mockup's invented room
positions.

### Ambient venue hours — real data from the QRG (feeds the "opens/closes at X" feature)
- **Registration:** Thu 10:00–4:30 & 6:15–10:00 · Fri 10:00–10:00 · Sat 11:30–10:00 · Sun 11:00–1:00
- **Dealer's Den:** Fri 10:00–6:00 · Sat 11:00–6:00 · Sun 10:00–4:00
- **Art Show:** Thu 6:30–8:30 · Fri 10:00–5:00 · Sat 11:00–5:00 · Sun 10:00–1:30
- **Shuttle Bus:** Thu–Sat 9:30–11:00 · Sun 9:30–9:00 (departs Delta, marked outside each main
  entrance)

### Georeferencing the underground floors — align by shared circulation cores
**Confirmed by calling the hotel: Wyndham Parking 1 and Parking 2 are underground levels**, stacked
beneath the Main Floor — not separate buildings. They have **no independent OSM footprint** to anchor
to, but they don't need one: vertical circulation passes straight through every level and gives exact
tie points.

- The Wyndham **Main Floor** plan shows an **elevator icon opposite the Front Desk** and a **stairs
  icon in the bottom-right**. The **same elevator and stairs appear on the P1 and P2 plans** — a
  shaft/stairwell is fixed in plan across every floor it serves. These are our **control points.**
- Alignment chain:
  1. **Main Floor → OSM.** Fit the Main Floor outline to the Wyndham OSM footprint (the shared ENU
     metric transform from research #4).
  2. **P1 / P2 → Main Floor.** Register each underground plan by **matching the shared elevator +
     stairs icons**. Two non-coincident control points fix translation, rotation, and uniform scale (a
     similarity transform) — enough to drop every P1/P2 room polygon into the same metric space, even
     though the parking footprint differs from the Main Floor's.
- Result: all three Wyndham levels — and the GPS dot — live in **one coordinate system**, though two
  are underground and invisible to OSM.

**This generalizes to any stacked floor.** Delta's 2nd Floor aligns to Delta Main the same way (shared
elevator/stairs), so we only ever OSM-anchor **one floor per building**; every other floor inherits
the transform through its circulation cores. Store the two control-point coords per floor alongside the
room polygons (in `rooms.json` or the build script) so the fit is reproducible.

**UX note:** since P1/P2 are underground, their floor pills should read as such (e.g. `P1 ·
underground`) so nobody hunts for them at ground level.

---

## Cognitive accessibility

The primary user is legally blind (covered by the existing magnification/contrast rules); the feedback
also asks about **cognitive** accessibility. Adopt as build rules:
- **Plain language, no jargon.** "no plans listed", not "unresolved intent". Short sentences.
- **Predictable, consistent layout** — same tab order, same control positions across screens; the
  alphabetical List order is a cognitive-load choice, not just aesthetics.
- **One primary action per screen**, visually obvious; secondary actions clearly subordinate.
- **Always offer a way out** — the custom-event cancel/back is one instance; no dead-end forms.
- **Confirm destructive/irreversible actions** (cancel event, leave crew) with a clear "you sure".
- **No time pressure / no auto-advancing** UI; honour `prefers-reduced-motion` (already planned).
- **Icons always paired with text labels** (tab bar, toggles) — never icon-only.
- **State shown redundantly** (shape + text, never colour/opacity alone) — already a core rule; it
  serves cognitive accessibility too.

---

## UI production workflow (directive for the build phase)

Per user: **for all future UI rendering, design each page first as an image via PowerShell → Codex
image generation, then convert that image to HTML.** Treat generated HTML mockups as *visual
approximations*, not ground truth — real geometry, room names, and hours come from verified data
(the Glacier lesson above). Record this as a persistent project convention (`bd remember`) once out
of plan mode.

---

## Beads backlog changes

Reconcile the existing 17-issue backlog with this round (do at build start, not in plan mode):
- **Amend M4 (`aau`)** to include: adaptive building/floor selector placement (below Map/List
  toggle, Map-tab only), List view as alphabetical text-map, and the **OSM outdoor basemap** (folded
  in) with a new `scripts/build-basemap.mjs` sub-task.
- **Amend M7 / a11y (`x8s`)**: split Display into Text size (discrete slider, lower default) + Theme;
  add the cognitive-accessibility checklist; ODbL attribution surface.
- **Amend M5 (`bgx`)**: custom-event free-text-first Where + cancel/back; Crew "Your Events" +
  Edit-into-creation + bottom Cancel-with-confirm.
- **Amend M3 (`gz6`)**: ambient venues show next open/close transition; digest built within the
  Telegram inline-HTML subset; document the `web_app` button bridge.
- **Amend M1 (`4cz`)** consent copy: concrete ghost-mode bullets; remove the gold header label.
- **New human-decision issue** (sibling to `k0y`): Wyndham Main vs Parking 1 — same elevation or
  different buildings?
- **Reinforce `k0y`** with the on-the-ground Glacier signal (likely rename of the Banff/Lake
  Louise/Jasper position).
- **New convention memory:** PowerShell→Codex image → HTML UI workflow.

---

## Verification additions (beyond the master plan's list)

- **OSM basemap:** generated SVG contains streets/parking/paths around both hotels; a known lat/lng
  (e.g. a hotel entrance) projected through the shared ENU transform lands on the correct baked
  geometry; ODbL attribution is present and reachable on the Site view; **no runtime Overpass/tile
  request** (network tab clean).
- **Text size:** discrete slider snaps to fixed stops, persists across reload, and scales every screen
  from the root; default baseline is the new smaller value; range exceeds the old A++.
- **Floor selector:** renders only on the Map tab, below the Map/List toggle; building switch defaults
  to last-viewed floor; OSM stays rendered outside buildings at all zoom levels.
- **List view:** rooms alphabetical; each shows current panel + crew present with signal + staleness.
- **Custom event:** cancel/back discards cleanly from a misclicked `+`; free-text Where is primary.
- **Crew page:** no GoH alert here (it's on the event); "Your Events"; Edit reopens creation prefilled;
  bottom Cancel-event requires confirmation and marks `[CANCELLED]`.
- **Digest:** ambient venues render "opens 9:00 AM" / "closes 6:00 PM" per current time; digest is
  valid within the Telegram inline-HTML whitelist.

---

## Open items needing a human

**Both prior open items are now RESOLVED by the corrected QRG:**
1. ~~Where is Glacier?~~ → mapped on Delta 2nd (bad source PDF was the cause). Closed.
2. ~~Wyndham Main vs Parking 1 elevation?~~ → the QRG shows **Main, Parking 1, Parking 2 as three
   distinct levels of the one Wyndham building** — same building, different elevations. The floor
   selector `[SITE · MAIN · PARKING 1 · PARKING 2 · DELTA]` is correct as drawn. Closed.

No human-decision items remain open for the map.

---

## Immediate next step — re-render the mockup (edit HTML directly)

Decision: this round, apply the changes **directly into `C:\Users\QCeplis\Downloads\furehscreens.html`**
(it is hand-authored HTML/CSS, not image-derived), skipping the codex image-gen step just for this
pass. The PowerShell→Codex image workflow remains the default for *net-new* page designs going
forward.

Concrete edits to make in the mockup, in order:
1. **First open:** add 3 plain ghost-mode bullets (crew sees "no plans listed"; you don't appear on
   the map; stars/`.ics`/schedule still work).
2. **Me tab:** split "Display" → **Text size** (discrete slider `S·M·L·XL·XXL`, lower default) +
   **Theme** (Dark/Light), each its own labelled section.
3. **Add-event:** free-text "Where" first, "tap a spot on map" secondary; add an `✕`/Cancel in the
   header.
4. **Map header:** `[🗺 Map | ☰ List]` toggle first, then the adaptive building/floor selector
   **below it and only on the Map tab**; remove the gold top-right "when" label.
5. **Delta 2nd floor plan:** replace Banff/Lake Louise/Jasper with the **corrected rooms** — Fort
   McMurray, Red Deer, Medicine Hat, Edmonton, Canmore (Headless Lounge), **Glacier**, Lethbridge,
   Calgary, Grande Prairie — laid out per `static/FUREH2026_HOOM_QRG_WEB.pdf`.
6. **Map List view:** rebuild as a text view — **alphabetical** room headers, each with current panel
   + crew present + signal (GPS/star/agree) + staleness badges.
7. **Bot digest:** ambient footer shows **"opens 9:00 AM" / "closes 6:00 PM"** using the QRG hours;
   keep within Telegram's inline-HTML subset.
8. **Crew page:** remove the GoH alert (move to the GoH event listing); rename "Unofficial events" →
   **"Your Events"**; drop the standalone cancel card; add **Edit** on the room-party card and a
   bottom **Cancel event** (with "you sure").
9. Add an **"© OpenStreetMap contributors"** attribution on the Site view (for the baked OSM
   basemap).
