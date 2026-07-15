# Fur-Eh 2026 Crew — a Telegram Mini App + web schedule

## Context

Fur-Eh 2026 runs **July 16–19, 2026**, across the **Wyndham** and **Delta** hotels in Edmonton. The official schedule (`events.fureh.ca/2026/schedule/`) is one huge scrolling page; even filtered to starred items it's slow, and there's no way to see what friends are doing.

Build a shared schedule that:
- lets friends compare picks and see **where everyone is**, so you can rejoin people after a panel without pinging the group chat,
- shows it on a **clear, magnifiable vector floor plan** of the venue,
- lets anyone add **unofficial events** (room parties, dinners) the official schedule will never carry,
- exports stars as a **single universal `.ics`** so your phone can remind you without opening anything.

Ships as a **Telegram Mini App** (most of the group is on Telegram), served from the same Cloudflare Worker at a plain `https://` URL for everyone else.

### Deadline shape

Two deadlines, not one. **You arrive Thursday; most friends travel Friday noon and land Friday evening.**

- **Before Thursday:** schedule browser, stars, import, `.ics`. All solo value.
- **Before Friday evening:** crew sync, the bot's pinned digest, the map, custom events.
- **During the con:** live location, polish.

---

## Accessibility is a core requirement, not polish

**The primary user is legally blind and browses at near-maximum magnification.** This is a hard constraint that shapes the architecture, and it is the reason the map is drawn rather than photographed.

Non-negotiable build rules:

- **The map is vector (SVG), never a raster image.** See below — this is the single biggest design decision in the project.
- **`rem` units everywhere, 16px floor.** Plus an **in-app text-size control (A / A+ / A++)** — we do not trust Telegram's webview to honour OS text settings, so we guarantee it ourselves.
- **Never block zoom.** No `maximum-scale`, no `user-scalable=no`. Layout reflows at 400% with **no horizontal scrolling anywhere** — the **map alone is exempt**, since a floor plan is irreducibly two-dimensional (WCAG allows this), which is exactly why it also ships a **List view** as a peer.
- **No horizontally-scrolling strips.** Content that would overflow **wraps**. (Off-screen avatars in a side-scroller are invisible at high magnification.)
- **Contrast targets AAA (7:1)**, not AA. Both light and dark themes.
- **Opacity must never carry meaning.** Encode state with shape, fill, and text. A "ghosted" 45%-opacity marker makes the low-confidence case the hardest one to see — exactly backwards.
- **44×44px minimum touch targets.**
- **Semantic HTML** (`<button>`, `<nav>`, headings, `<time datetime>`), visible focus rings, `prefers-reduced-motion` honoured.

Two surfaces are accessible *by inheritance* and are worth keeping partly for that reason: the **bot's pinned message** (plain text in Telegram's native client) and the **`.ics` export** (lands in the OS calendar app, which has mature large-text support we will never match in a weekend).

### Theme — "Lord of the Wings"

**Fantasy in the chrome, never in the content.**

- **Chrome** — headers, tab bar, buttons, empty states, map border/compass, dividers, the bot's message header: display serif, illuminated drop caps, gold rules, wing motif. Have fun.
- **Content** — schedule rows, room labels, times, names: a boringly legible sans, high contrast, **no texture behind text, ever.** Parchment texture under body copy is the classic way fantasy theming destroys readability.
- **Light** = ink on vellum (near-black on warm off-white — *not* beige parchment, which can't hit 7:1). **Dark** = gold-on-deepwood, using fur-eh's own green `#3aa57c` plus amber-gold accents on near-black.

---

## The map — vector, drawn from scratch

**This replaces the earlier plan to extract images from the official PDF. That plan is dead.**

The official Quick Reference Guide's floor plans are **baked raster art with tiny hand-lettered serif labels**. Magnified, they get blurrier, not clearer. A raster map cannot serve the primary user, full stop.

But we were already hand-authoring polygons for all 21 rooms to make hotspots work — **and those polygons are a vector floor plan.** So we draw it:

- **Crisp SVG**, infinitely magnifiable, our own text labels at any size.
- **High contrast by construction.** AAA in both themes.
- **Full facility set**, not just panel rooms: room labels, **washrooms, elevators, stairs, front desk, entrances, "to parkade"**, registration, cafés, lounges — everything in the QRG legend.
- **We read the PDF only as a reference** while authoring coordinates. **We ship no images.**

This deletes an entire milestone's worth of risk: no JPEG 2000 decoding, no crop masking, no panel-bleed problem, no 1 MB image budget, no PDF slowness. It is simultaneously the accessible choice, the fast choice, and the simple choice.

### Hierarchy: Site → Building → Floor

| Level | Content |
|---|---|
| **Site** | Simple vector schematic: the three hotels on Gateway Blvd. Also crisp, also labelled. |
| **Building** | Wyndham (Main Floor · Parking 1 · Parking 2) · Delta (Main Floor · Second Floor) |
| **Floor** | Rooms, facilities, live events, crew positions |

**Off-site events** (the Guest of Honour Dinner, see below) get an address and a link that opens the user's own maps app — which is accessible and magnifiable in ways a static street image would not be.

### Room coverage — verified room-by-room against the feed

**18 of 21 rooms are on the floor plans.** All three exceptions are known and handled.

**Wyndham — all 10 mapped ✅**
| Floor | Rooms |
|---|---|
| Main Floor | **Terrace 1** (Escape Room), **Terrace 2** (Art Show), **Terrace 3** (Art Lounge), **Terrace 4** (Registration), **Terrace 5** (Game Room), **Atrium** (Atrium Café), Lounge |
| Parking 1 | **Imperial** (Second Stage) |
| Parking 2 | **Main Stage** (Adela), **Gallery 1** (Headless Lounge), Gallery 2, **Gallery 3**, Fitness/Pool, Gen Ops |

**Delta — 8 mapped ✅**
| Floor | Rooms |
|---|---|
| Main Floor | **Dealer's Den** (Market of Meowria), 18+ Dealer's Den (Market of Meowdor) |
| Second Floor | **Fort McMurray**, **Red Deer**, **Medicine Hat**, **Edmonton**, **Canmore** (Headless Lounge), **Lethbridge**, **Calgary** |

### 🚩 The one real gap

**`Delta - Glacier Room` has 13 scheduled sessions and appears on no floor plan.** Meanwhile the Delta plan shows **Banff, Lake Louise, Jasper and Grande Prairie — all with zero sessions.** A room was almost certainly renamed between the map going to print and the schedule being locked, but **the PDF cannot tell us which one.**

**This needs a human** — ask con staff, or someone who's been in the building.

**Until then it renders as "location unknown — ask at Registration", never a guessed pin.** A confidently wrong map is worse than an incomplete one, especially for wayfinding.

**Legitimately off the plans** (explicit allow-list, or the build gate fails on them):
- `Delta - Downtown` — **off-site.** The Guest of Honour Dinner moved to the *Delta Edmonton Downtown* main ballroom (water damage; tickets still valid). Surface as a **real in-app alert**, with an address and a link out to the user's own maps app.
- `Delta - Parking Garage` — Motorama. A parking garage, not a mapped room.

### Other confirmed facts

- **Holiday Inn hosts no programming.** Every scheduled room is Wyndham or Delta.
- **Wayfinding worth surfacing:** Main Stage is on **Parking 2**; Imperial is on **Parking 1**.

---

## Where people are

**Stars know the room, and therefore the floor — exactly.** A starred event names its room; the room names its floor. Zero inference.

**GPS knows roughly the building, and nothing else.** Telegram's `Location` object carries lat, lng, and an accuracy radius the Bot API documents as **0–1500 m**, and **no altitude or floor field at all**. Indoors it lands at 10–50 m; rooms are ~20 m apart. It can never resolve a room and it can *never* resolve a floor.

So they fuse:

| Signals | Rendering |
|---|---|
| GPS **+** a star on this floor | **Solid filled pin** in the room. GPS confirms the building, the star supplies the floor. **This is what Telegram alone cannot do.** |
| GPS only | **Hollow ring** at its true georeferenced position, on every floor of that building, with its accuracy circle. Legend explains the shape once — **no per-dot label noise.** |
| Star only (the default) | Avatar in the starred room. Exact. |
| Two overlapping stars | Appears in **both** rooms with a `?`. Honestly ambiguous beats confidently wrong. |
| Nothing | No marker. |

*Accepted tradeoff:* an unconfirmed ring appears on floors the person may not be on. Shape-coding carries the uncertainty; opacity does not.

**If GPS puts someone outside both building footprints, they render on the Site view, not on any floor.** (Off-site is a real state — the Guest of Honour Dinner is genuinely across town. Earlier drafts had this rule and it got lost.)

### Georeferencing: draw in real coordinates, don't fit a transform to art

An earlier draft killed the GPS-on-floorplan feature, reasoning that projecting real coordinates into a *stylized* drawing would produce systematic error dressed as precision. **That reasoning was wrong, because we are not tracing the stylized drawing — we are redrawing the map ourselves.** So we draw it in real-world coordinates from the start:

- **The OpenStreetMap building footprint is the outer boundary of each floor.** Correct scale, correct rotation, correct position — *by construction*, not by fitting.
- **The QRG becomes a topology reference only** — which room adjoins which, roughly how big — never geometry.
- **The SVG coordinate space is metres on the ground**, so **lat/lng → map position is exact**. No fitted transform, no systematic error.

**Verified, both footprints exist in OSM with real geometry:**

| Building | OSM way | Footprint | Vertices |
|---|---|---|---|
| Wyndham | `321836536` | 83 m × 108 m | 43 |
| Delta | `321840654` | 51 m × 107 m | 83 |

**Centre-to-centre separation: 102 m.** Against 10–50 m indoor GPS error, telling the two buildings apart is **robust**, not marginal.

**Error budget:** our eyeballed interior room placement may be off by 5–15 m *inside a correct outline* — smaller than the GPS error it's displaying. **The drawing error costs nothing.** The feature stands.

`src/data/buildings.json` holds the two footprints and the metres-per-pixel origin.

**Every marker shows staleness ("last seen 11m ago").** A stationary phone reports rarely — someone sitting through a 50-minute panel is the *worst* case for freshness. A stale marker must look stale.

Strokes are thick and fills are solid. The accuracy circle is a real filled area with a strong border, not a 1px dashed hairline.

### Live location: opt-in, DM to the bot

- Shared via **Live Location in a private chat with the bot**. Telegram's own UI supplies consent, the 15min/1h/8h expiry, the persistent banner and the stop button — **we build no consent flow.**
- **The bot stays in default privacy mode**, so it reads **nothing** in the group chat. (Reading a location *in the group* would require disabling privacy mode, making the bot receive every message your friends ever send. Not worth a dot.)
- Off by default. Never nagged.

---

## Stack — Workers + Durable Objects, Paid plan

**Cloudflare Workers + Durable Objects (one per crew, each with its own Alarm) + Static Assets.** One `wrangler deploy`. **Workers Paid ($5/mo) from day one** — deliberately, so the app can't die over a $5 difference.

**Why not KV (the original choice):** KV was right when the only writes were debounced stars (~8/person/day). Live location breaks it.

> ⚠️ *Correcting my own earlier argument:* I first justified this with "4,800 writes/day blows the 1,000/day free-tier ceiling." **On the Paid plan that reasoning is void** — paid KV has *no* daily cap, just a 1M/month included allowance we'd never reach. The real reasons stand on their own, and are stronger:
> - **KV rate-limits writes to the same key to 1/second.** Live location is precisely a hot-key rewrite pattern. This is a hard wall, not a quota.
> - **KV is a cache, not a database** — eventually consistent, with documented cross-region propagation up to 60s. Shipping a *live* feature on a store that can be a minute stale would be dishonest.

**A Durable Object fixes both:** strongly consistent, serialised writes, no hot-key limit, and a natural home for the location throttle.

The DO's serialised writer also means the old "each member may only write their own key" rule — a KV lost-update workaround — is no longer load-bearing.

**No WebSockets.** A Mini App is frozen the moment the user swipes back to the chat — which is the *natural* gesture here ("checked the map, now replying to Val"). A socket doesn't survive that; you end up writing reconnect logic and getting poll-like behaviour anyway. Nothing here is latency-sensitive: GPS itself only updates every 30s–few minutes. **45s polling, stopped entirely when not visible.**

> This is also the one thing that could actually cost money. DO *duration* is billed on wall-clock while the object is active, and **plain (non-hibernating) WebSockets keep it active 24/7** — 50 crews held open for four days would be ~2.16M GB-s against a 400k allowance, roughly **$22 in overage.** Staying on HTTP keeps duration near zero. If sockets ever become necessary, they must use the **Hibernation API** (`state.acceptWebSocket()`).

### Verified cost: **$5.00/month, everything inside the included allowances**

For ~50 crews over 4 days: ~57,600 alarm invocations plus app traffic ≈ 160k DO requests (1M included), <500k rows written (50M included), ~72k GB-s duration (400k included). **Static asset requests are free and unlimited.** No overage.

### Durable Object gotchas — get these right on the first deploy

1. **Use `new_sqlite_classes`, NOT `new_classes`.** `new_classes` creates KV-backed DOs, which are now restricted to accounts that already have one — on a new account it will simply fail. **And you cannot convert a deployed KV-backed class to SQLite.** This is the single most expensive mistake available here.
2. **Alarms are at-least-once, with up to 6 retries.** A retried alarm that re-posts to Telegram will **double-post**. The `alarm()` handler **must be idempotent** — guard with a dedupe key in SQL.
3. **Alarms don't repeat — re-arm inside the handler**, at the *start*, so a mid-handler throw still leaves a future alarm armed. **One alarm per DO**; `setAlarm()` overwrites.
4. **Telegram webhooks need a fast 200.** Write, return, and push slow work into `ctx.waitUntil()` — don't block the response.
5. **Migration tags are permanent and append-only.** Renaming the class needs a `renamed_classes` migration, not just a code edit, or the data is orphaned.
6. Route with `idFromName(crewId)` for stable, derivable IDs.

```jsonc
{
  "assets": {
    "directory": "./dist/",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/telegram/webhook"]
  },
  "durable_objects": { "bindings": [{ "name": "CREW", "class_name": "Crew" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Crew"] }]
}
```

**Why DO Alarms and not a Cron Trigger:** Cron Triggers cap at **250 per account**, and a single cron would have to *enumerate every crew* — but we dropped KV, so there's no registry to enumerate. Per-crew alarms need no registry, scale past the cron ceiling, and come with free retries.

**Client:** Vite + Preact, **TypeScript** (strict), plain CSS, no date library (`Intl.DateTimeFormat` suffices — no DST transition during the con). Worker/DO typed with `@cloudflare/workers-types`. **Brand occurrence-ids vs item-codes** and model the marker-fusion states and DO storage records as **discriminated unions**, so the compiler — not just runtime asserts — guards the occurrence bug and the fusion logic. (This reverses the earlier plain-JS default; the risky parts here are all shape-and-invariant heavy, and greenfield is the cheapest moment to switch.)

**Prerequisites (~10 min, yours):** Cloudflare account → `wrangler login`. **@BotFather → `/newbot`** (instant, free, no review) → `/newapp` → `wrangler secret put BOT_TOKEN`.

---

## Identity & auth

**Resolve once, then one access code for everyone.**

1. The Mini App opens. Telegram hands it a **cryptographically signed `initData`** blob.
2. `POST /api/resolve` verifies the signature (HMAC-SHA256; `secret = HMAC(bot_token, "WebAppData")` — note the argument order), then **mints an access code** and returns it.
3. **Every later request presents that code.** Telegram users and web users then travel *the same code path*.

This deliberately keeps the **web client first-class** rather than a bolted-on afterthought — web users already get a random code stored in their browser, so now there is exactly one mechanism, not two.

**Onboarding is deleted, not designed.** `initData` carries `first_name`, `username` and `photo_url`, so real Telegram names and avatars just appear. No name entry, no emoji picker, no account. (Deterministic coloured-initial fallback for anyone hiding their photo.)

**The crew is the group chat.** The bot generates a crew id when added to a group (it knows the `chat_id` then) and the pinned link carries it as a `startapp` parameter, which arrives inside `initData`. Nobody invites anybody.

**Not on Telegram?** Open the plain `https://…/c/<crewId>` link, type a display name once, get a coloured initial. Full member — stars, map, `.ics`. They just don't see the bot's pinned message, because they're not in the group.

⚠️ **The Telegram in-app browser is not your Safari**, so your fur-eh login doesn't exist inside it. The import link must open in the *real* browser via `WebApp.openLink()`. Doing the import once on a desktop is smoother.

---

## The bot — one pinned message, no notification spam

Each crew's **Durable Object sets its own 5-minute alarm** and `editMessageText`s a **single pinned "Happening Now"** message: what's on, who's going, what's next, who's free, and a button into the Mini App.

> **Use DO Alarms, not a global Cron Trigger.** A cron would have to *enumerate every crew* to know who to update — and since we dropped KV, there is no crew registry to enumerate. Each DO scheduling its own alarm needs no registry at all and scales naturally. (Earlier drafts said "cron every 5 min"; that was an architectural gap.)

**Telegram edits do not fire notifications**, so the digest updates all weekend without pinging anybody. **This works for people who never open the app at all** — and it's fully accessible, being plain text in Telegram's native client.

⚠️ **The one exception: *pinning* does fire a "X pinned a message" service notification.** Pass **`disable_notification: true`** on the pin call. Without it, the very first thing this "zero notification" feature does is notify everybody.

**Admin rights and the fallback.** Pinning requires the bot to be a group admin, which only an existing admin can grant. So:

- If it **can't** pin → it posts a fresh digest **every 30 minutes** instead, with one unobtrusive line: *"Make me an admin to pin this instead of reposting."*
- Telegram notifies the bot when its own status changes (`my_chat_member`), so **the moment someone promotes it, the bot pins its next digest and switches to quiet-edit mode by itself.** The nag line disappears. No configuration.
- **The one irreducible manual step:** a human must *add* the bot to the group — Telegram forbids bots from joining on their own, by design. We make it a single tap via a deep link to Telegram's group picker. If you create the crew group yourself, you're its admin and both steps take ten seconds.

---

## Data model

One Durable Object per crew.

```
crew:<crewId>
  meta     { crewId, tgChatId, pinnedMsgId, pinMode: 'edit'|'repost', createdAt }
  members  { memberId → { name, photo, stars:[occId...], loc|null, rev, updatedAt } }
  events   { eventId  → { ownerId, title, start, end, place, pin:{level,x,y}|null,
                          notes, cancelled:bool, seq } }
```

- **Custom events are their own records, not nested inside a member.** This is what makes the leave/cancel split below possible.

🚩 **Expiry must be written by hand. Durable Object storage has NO TTL.** Earlier drafts said `loc` "carries a short TTL" and "everything expires after 60 days" — that was **KV thinking carried into a DO design, and it is not implementable as written.** KV had `expirationTtl`; DO SQLite has nothing of the kind. Nothing expires unless we delete it.

So expiry becomes code, enforced in the alarm that's already running every 5 minutes:
- **Stale `loc` is purged on every alarm tick** (older than ~20 min → drop it). Also treat it as absent on read, so a missed tick can't resurrect a stale dot.
- **After the con + 60 days, the DO deletes its own storage** (`deleteAll()`) and stops re-arming its alarm.

If we don't build this, the "it all evaporates after the con" privacy promise is simply false.

### Leave ≠ cancel

"Leave & delete my data" was doing two unrelated jobs. Split them:

- **Leave the crew** — removes you from the roster and the map. **Pure privacy. No side effects on anyone else's plans.** (Otherwise leaving over unrelated drama would silently cancel your room party on four people who'd already committed.)
- **Cancel this event** — a separate, explicit action, shown only on events *you* created. Real cancel semantics: it shows as `[CANCELLED]` to everyone who starred it rather than silently vanishing.
- The leave flow offers a checkbox: **"also cancel all my custom events."** Both, in one motion, when that's genuinely what you mean.

🚩 **That checkbox MUST default to unchecked.** Pre-ticked, it would make a privacy action silently destroy other people's plans by default — a textbook dark pattern, and exactly the failure the split was designed to prevent.

### Stars are per-*occurrence*

Fur-eh schedules a repeating thing as **one item scheduled several times**, and its stars attach to the *item*. So starring `Registration` would star all **5** of its slots; `Do Your Dailies` all **4** days; a Headless Lounge all four, including the 2am ones. That would leak into the `.ics`, the map, and the roster — over-reporting everywhere.

**Stars are stored per occurrence.** Import expands each starred item into all its slots (fur-eh genuinely doesn't know which day you meant), and you prune the ones you don't want. Visible and fixable, rather than invisible and wrong.

### API

```
GET    /api/health
GET    /api/schedule            → normalized, edge-cached 10 min
POST   /api/resolve             → initData → { crewId, memberId, accessCode }
GET    /api/crew/:crewId        → members, stars, custom events, live locations
PUT    /api/crew/:crewId/me     → my stars / profile
POST   /api/crew/:crewId/events → create custom event
PATCH  /api/crew/:crewId/events/:id → edit / cancel (owner only)
DELETE /api/crew/:crewId/me     → leave (optionally cancel my events)
POST   /api/tg/webhook          → bot commands, my_chat_member, live location (DM only)
   [DO alarm, 5 min]            → editMessageText / repost the digest (self-scheduled per crew)
```

No ICS endpoint — the `.ics` is generated in the browser. The server never sees it.

**Write discipline:** stars mutate optimistically; the `PUT` is debounced 3–5s and flushed on `pagehide` with `keepalive`. Rapid-starring 20 events costs one write.

---

## Schedule data: baked **and** live

`scripts/fetch-schedule.ts` fetches both pretalx endpoints, joins on `code`, **expands occurrences**, writes a committed `src/data/schedule.json`.

**The occurrence bug — the one that would have shipped silently.** A pretalx `code` is a *submission*, not a time slot: 208 slots collapse to **178 unique codes**. Pretalx's own ICS reveals this with UID suffixes (`-0`, `-1`, `-2`). Assertions: 208 slots, 178 codes, 4 days, `Registration` → **5 occurrences**, `CZKVLN` → **4**.

**Occurrence ids must be stable across schedule updates.** Do **not** key on an occurrence *index* — a cancelled slot renumbers everything after it, silently changing every ID. Key on **`code` + start timestamp**.

**Other data facts:**
- **There is no speaker data.** `persons: []` and `speakers: []` across the feed. Search covers **title, abstract, track, room** — do not promise speaker search.
- **25 sessions run >6 hours** (Dealer's Den, Registration, Art Show, the lounges). These are **ambient venues, not panels.** 🚩 *This rule lost its home when the Now tab was deleted — it must be re-applied to the two surfaces that now answer "what's on":* the **bot's digest** (ambient venues go in a one-line footer, never the headline) and the **map's room highlighting** (an always-open room is not "happening now"). Without this, the digest is permanently topped by "Registration is on", every day, forever.
- **4 sessions have no `code`** (the "Overflow Seating" entries). Synthesise `id:<n>`; they can't be favourited in pretalx anyway.
- Pretalx localizes strings: names arrive as `"Main Stage"` **or** `{"en":"Main Stage"}`. Normalize, or you get `[object Object]`.
- **All day-grouping is `America/Edmonton`, regardless of device timezone.** Travellers' phones will be on Pacific/Central.

**Fur-eh will move rooms and cancel panels mid-con.** The Worker serves `GET /api/schedule` (re-fetch, normalize, edge-cache 10 min); the client tries it first and **falls back to the baked copy** offline. Always fresh, never blank. No redeploy needed.

---

## Client — four tabs

The **Now** tab is gone. It was Schedule-scrolled-to-now with a roster bolted on, and the bot's pinned message already owns "right now" from inside the chat you're already reading.

**Schedule** — the catalogue. Day tabs, grouped by time. Crew avatars on each row.
- **The roster *is* the filter.** One wrapping row: an **All** pill, then crew avatars with **yours first**. Tap an avatar → filter to their stars. Tap yours → "mine". Tap several → the union. This collapses `All / Mine / Crew` *and* per-person filtering into one control instead of four concepts.
- Free-vs-busy rides on the avatar as **ring + text**, never colour alone.
- Filters: track, room, search (title/abstract/track/room).
- A **`+`** for unofficial events.

**Map** — where everyone actually is. Site → Building → Floor. This is now the *only* home for "where are my people", so it carries real weight.
- **With a List toggle**, as a peer view, not a fallback. At high magnification, panning a large vector map is slow; a text list ("Red Deer Room, Delta 2nd — *Content Creator panel*, 12:30 — Val and Pip") is often **faster to read than the map itself.** Same data, same tab, one toggle. Cheap to build and likely the view you'll actually live in.

**Crew** — members, custom events, invite link for non-Telegram friends.

**Me** — text size, theme, `.ics` download, live-location opt-in, leave.

### First run — the app must not open empty

Most friends have **never starred anything on fur-eh.** Their first thirty seconds must not be a setup chore.

- **Land on Schedule, populated by the crew.** Useful before you've done anything, because *other people's* stars fill it. Starring becomes a natural next tap ("Val's going, I'll go too"), not a prerequisite.
- **Import is demoted** to a quiet line on Me: *"Already starred things on fur-eh? Import them."* It's a shortcut for the few who need it, not a setup step.
- **Nothing blocks.** No wizard, no profile completion.

🚩 **But one thing must be said out loud.** Deleting onboarding also deleted the only moment where anyone learns that **their starred events are visible to everyone in the crew.** As drafted, tapping the pinned link out of curiosity silently puts your name in the roster and your plans on the map — nobody ever consented to that.

**Fix:** a **one-time, non-blocking** notice on first open — *"You've joined <crew>. Your starred events are visible to this group. You can leave any time."* One line and a Continue. Not a wizard, but not nothing either. Consent for visibility is not a feature we get to skip because we were proud of having no onboarding.

### Say what we know, not what we've inferred

Someone with no starred events is **not** necessarily free — they may simply not use the app. Labelling them **"FREE"** asserts a fact we don't have and quietly applies social pressure ("you're free, why aren't you here?").

**Label it "no plans listed."** Honest, and it removes the implication.

### Custom events

`+` opens: title, day, start/end, notes, and **where**.

- **Tap-to-place on the map** — you tap the floor plan *on screen* (nothing to do with being physically present); a pin drops. Works days in advance.
- Free text stays available for things that aren't really *at* a place.
- Off-site things pin at the **Site** level.
- ⚠️ **Guest rooms are not on the floor plans** (the QRG shows conference space, not guest corridors). A pin for "Rm 1412" is approximate — the room number in the title does the real navigational work, which is how people find rooms anyway.
- Anyone can star a custom event; only the owner can edit or cancel it.

### Import flow — be obsessive; your friends won't debug it

1. **A link** (real browser, new tab) → the official schedule. *"Open this while logged in"* — that pushes your browser-local stars up to your account.
2. **A second link** → the favourites endpoint, which prints the raw JSON array on screen.
3. *"Select all, copy, paste below."*
4. **Parse liberally** — a JSON array, a comma/newline list, or the whole copied page with junk. Regex out `\b[A-Z0-9]{6}\b` and **intersect against known codes**, so over-matching is harmless. Confirm *"Found 34 — all 34 matched"* and list the titles.

**Why it can't be automatic:** the favourites endpoint sends `Access-Control-Allow-Origin: *` **without** `Access-Control-Allow-Credentials` — the browser refusing to let any other site read your favourites with your cookies. That's correct security on pretalx's part, and there's no way around it short of asking for your password.

One-time only. Afterwards **this app owns your stars**; we never sync back.

---

## Calendar: one universal, static `.ics`

**One button. Everyone gets the same thing.**

Apple could have had a live `webcal://` subscription; **Google cannot subscribe from a phone at all** and lags 8–24 hours. Building the good version for one platform and a workaround for the other would privilege some users and exclude others. A static file that works identically everywhere is the fairer answer — and it happens to delete the entire subscription apparatus (server endpoint, refresh hints, re-import dedup, cancellation lifecycle).

- **Static, not live.** A snapshot of your stars. Plans changed? Download again.
- **The app is the live surface.** The calendar does the one job the app cannot: **put your day on your lock screen, watch and widgets without opening anything** — in apps with mature magnification support.

🚩 **Contradiction caught:** an earlier draft justified the `.ics` with *"passive reminders"* and then specified **`No VALARM`** — which disables reminders entirely. You'd get events you can *see* but never get *alerted* to. Pick one.

**Resolution:** an **opt-in checkbox on the download — "remind me 10 minutes before"** — which adds a `VALARM` to each event. **Default off**, because 34 unsolicited alerts is genuinely awful, but available to anyone who wants the con to actually tap them on the shoulder. And the justification above is reworded to what a no-alarm `.ics` truthfully delivers: visibility, not alerts.

**Correctness (`src/app/ics.ts`, client-only):**
- **Per-occurrence UIDs keyed on `code` + start time** — not an index. Without this, four days of Headless Lounge collapse into one event.
- **Fold at 75 *octets*, never splitting a UTF-8 sequence** (custom events contain emoji). **Escape `\ ; ,` and newlines.** Unfolded or unescaped lines make Apple Calendar silently import *nothing*, with no error. **Write and test these two functions first.**
- **UTC `Z` times.** No `VTIMEZONE`; omit `X-WR-TIMEZONE`.
- **CRLF** endings. `DTSTAMP` on every event. `METHOD:PUBLISH`. `VALARM` only if the user asked for it.

---

## Privacy

- **The crew is the group chat.** No public index, no crew-list endpoint, no cross-crew discovery. `X-Robots-Tag: noindex` + disallow-all `robots.txt`.
- **The bot stays in default privacy mode** — it reads nothing in the group but commands addressed to it.
- **Live location is opt-in, DM-only, ephemeral, Telegram-governed.** Off by default, never nagged.
- **No check-ins, no chat, no photos, no push.** The app models **intent**, not surveillance.
- **60-day expiry** — *enforced in code, not by a TTL that doesn't exist* (see the data model).
- **Leave** is immediate and one tap. **Leaving revokes your access code**, so a stale code can't keep writing.
- **`<meta name="referrer" content="no-referrer">`** — otherwise the crew URL leaks in the `Referer` header the moment someone taps through to a pretalx talk page.
- **Zero third-party requests at runtime.** No analytics, no CDN fonts, no map tiles. Self-host the fonts.
- **Telegram avatars are proxied through the Worker**, not hotlinked. `photo_url` lives on Telegram's CDN, so rendering it directly would leak every viewer's IP to Telegram on every load — and quietly falsify the line above. Proxy is cheap and cacheable; do that.

### 🚩 Ghost mode — restored

**Ghost mode existed in the first design and silently disappeared through the redesigns.** Nobody decided to cut it; it just fell out. As the plan currently stands, **joining the crew means being visible, and the only way to opt out is to leave entirely** — a very coarse choice for a furry con, where being seen at a particular panel is exactly the thing some people can't afford.

**Ghost mode:** your stars still sync, your `.ics` still works, the map and schedule are still fully usable — but the crew sees you as *no plans listed*. One boolean. Roughly fifteen minutes of work, and for this audience it is plausibly the difference between "I'll use this" and "I won't."

---

## Build order

Sequenced by **what must work when**. Hours are omitted deliberately: with AI writing the code, wall-clock is dominated by review, deploys, and the few things only you can do (Cloudflare account, BotFather, the fur-eh copy-paste, testing on your phone).

**Before Thursday — solo value, no crew needed**

| # | Milestone | Outcome |
|---|---|---|
| M0 | Scaffold; `fetch-schedule.mjs` with occurrence expansion + assertions | Clean data |
| **M1** | **Static SPA, no backend.** Schedule browse/filter/search, star locally, paste-import, **`.ics` download**. **Accessibility baseline built in from the first commit** — rem/16px floor, text-size control, AAA contrast, 44px targets, semantic HTML | **Beats the official site; your stars are in your calendar. If everything else fails, this ships.** |

**Before Friday evening — when friends land**

| # | Milestone | Outcome |
|---|---|---|
| M2 | Worker + **Durable Object**; `resolve` + access codes; crew state; `/api/schedule` | Live shared crew, zero onboarding |
| **M3** | **Bot: pinned "Happening Now"**, DO-alarm-edited; repost fallback + auto-upgrade on promotion | **Works for people who never open the app** |
| **M4** | **Map**: vector SVG floors + facilities, Site→Building→Floor, room hotspots, **List toggle**, crew placed by stars | The centrepiece |
| M5 | Custom events: create / cancel, tap-to-place, crew-visible, starrable, into the `.ics` | Room parties & dinners |
| M6 | Live location: DM opt-in, solid pin vs hollow ring, accuracy circle, staleness | Ambitious, honest |
| M7 | Theme polish (Lord of the Wings, light + dark), privacy sweep | Ship-ready |

**Cut in this order:** live location → web-fallback onboarding (Telegram-only) → custom-event *editing* (keep create + cancel) → map facilities detail (keep rooms) → tap-to-place (free text only).

**Never cut:** the accessibility baseline, schedule browse/filter/search, starring, import, `.ics`, crew sync.

---

## Critical files

- `wrangler.jsonc` — **the one thing that must be right:** with Workers Assets, `not_found_handling: "single-page-application"` returns `index.html` for every unmatched path and will swallow the API routes. `run_worker_first: ["/api/*"]` is the fix. Also holds the DO binding and the `new_sqlite_classes` migration. (**No cron trigger** — earlier drafts said so; alarms replaced it.)
- `scripts/fetch-schedule.ts` — pretalx join + occurrence expansion. Everything depends on this shape.
- `src/data/rooms.json` — **the vector floor plans**: room and facility polygons in **real-world metres**, labels, floor, building. Hand-authored using the OSM footprint for geometry and the QRG for topology. Also holds the **off-map allow-list** (`Delta - Downtown`, `Delta - Parking Garage`) and any **location-unknown** rooms (currently `Delta - Glacier Room`).
- `src/data/buildings.json` — OSM footprints (Wyndham way `321836536`, Delta way `321840654`) and the metres↔pixels origin. This is what makes GPS positions exact rather than fitted.
- `src/worker/crew-do.ts` — the Durable Object. All crew state.
- `src/worker/telegram.ts` — `initData` HMAC validation, webhook, `my_chat_member` pin-upgrade, live-location ingest, digest.
- `src/app/ics.ts` — per-occurrence UIDs, octet folding, escaping. Client-only.
- `src/app/a11y.css` — text-size scale, contrast tokens, focus rings. Imported first, never overridden.

## Verification

> 🚩 **Build the `?now=2026-07-18T13:05:00-06:00` time-travel override FIRST.** It was in early drafts and got lost. **The con hasn't happened**, so without it there is no way to test the bot's digest, the map's "on now" highlighting, or the ambient/panel split — which are three of the four things most likely to be quietly broken on day one. Five lines of code; not optional.

**Also handle unknown rooms at runtime, not just at build time.** The build gate below catches rooms missing from `rooms.json` *at build*. But fur-eh can rename a room mid-con (that is very likely exactly what happened to Glacier), and the live `/api/schedule` would then serve a room the map has never heard of. It must degrade to "location unknown", never throw.

1. `npm run schedule` → asserts 208 slots / 178 codes / 4 days; `Registration` → 5 occurrences, `CZKVLN` → 4. **Occurrence ids stable across two runs** even if a slot is removed.
2. **`/api/health` returns JSON, not HTML** — the `run_worker_first` gotcha. First smoke test after deploy.
3. **Telegram auth**: open the Mini App from the real group; confirm a **tampered `initData` is rejected**.
4. **Accessibility, tested at your real magnification, not simulated:** reflow at 400% with no horizontal scroll; text-size control works; contrast measured ≥7:1 in both themes; every control reachable and 44px+; map labels crisp at max zoom.
5. **Map**: every one of the 21 schedule rooms resolves to **either** a polygon, the off-map allow-list, or the explicit *location-unknown* list. **A room in none of those three must fail the build**, not render a ghost. Today that means `Delta - Glacier Room` (13 sessions) is a known, tracked gap — not a silent one.
6. **Import round-trip**: paste your real favourites; matched count equals your star count on the official site.
7. **`.ics`**: RFC 5545 validator, then **import on your actual phone**. Verify the longest abstract folds without corrupting emoji, and Headless Lounge appears as **4 separate events**.
8. **Leave ≠ cancel**: leaving the crew must **not** remove a room party other people starred. The "also cancel my events" checkbox is **unchecked** on open.
9. **Bot**: the pinned message edits in place and **fires no notification** — including the initial pin (`disable_notification: true`). Promote the bot mid-run and confirm it self-upgrades from repost to pin.
10. **First-run consent notice** appears exactly once and is non-blocking. **Ghost mode** hides you from the crew while stars and `.ics` keep working.
11. **Expiry is real**: stale `loc` is purged by the alarm and treated as absent on read. Confirm the 60-day self-delete path exists — DO storage has no TTL, so if nobody wrote this code, the privacy promise is a lie.
12. **Time-travel**: `?now=2026-07-18T13:05:00-06:00` → the digest leads with panels, Dealer's Den and Registration appear only in the ambient footer, and the map highlights the right rooms.
13. Load under "Slow 4G" — that's hotel wifi.

## Open items needing a human

- 🚩 **Where is `Delta - Glacier Room`?** 13 sessions, absent from every floor plan. Ask con staff or someone who's been in the building. Almost certainly a rename of Banff / Lake Louise / Jasper / Grande Prairie — all four are drawn on the map with **zero** sessions. **This is the only unresolved gap in the entire plan.**

**Day-of runbook:** `wrangler tail` watches errors live. Schedule changes flow in within 10 minutes, no redeploy. If the Worker dies, the `.ics` is already in your calendar and the app still works from cache — you degrade, you don't fail.
