/**
 * Worker entry — the API + Telegram surface. Static assets are served by the
 * `assets` config; `run_worker_first` in wrangler.jsonc routes /api/* and the
 * Telegram paths here first so the SPA fallback doesn't swallow them.
 *
 * Thin de-risk slice: health, resolve (initData → access code), the webhook
 * (fast 200 + waitUntil), a one-shot setup endpoint (discovers the crew chat and
 * registers the webhook server-side so the bot token never leaves the Worker),
 * and a testing trigger that honors `?now=`.
 */
import type { Env } from './env';
import { Crew } from './crew-do';
import {
  getUpdates,
  setWebhook,
  verifyInitData,
  type TelegramChat,
  type TelegramUpdate,
  type TelegramUser,
} from './telegram';
import { effectiveNow } from './now';

// The Durable Object class must be exported from the Worker's main module so the
// `new_sqlite_classes` migration can bind it.
export { Crew };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isGroupChat(chat: TelegramChat): boolean {
  return chat.type === 'group' || chat.type === 'supergroup';
}

/** Bearer check for the admin endpoints. Fails CLOSED when the key is absent. */
function bearerOk(request: Request, key: string | undefined): boolean {
  return key !== undefined && key !== '' && request.headers.get('authorization') === `Bearer ${key}`;
}

// ── Route handlers ───────────────────────────────────────────────────────────

async function handleResolve(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ initData?: string }>().catch(() => null);
  const result = await verifyInitData(body?.initData ?? '', env.BOT_TOKEN);
  console.log(`resolve ${result.ok ? 'ok' : 'rejected'}`);
  if (!result.ok) return json({ error: 'invalid initData' }, 401);
  return json({ accessCode: crypto.randomUUID(), user: result.user });
}

/** Human label for a verified user — NEVER a client-supplied name. */
function displayNameFor(user: TelegramUser): string {
  return user.first_name ?? user.username ?? String(user.id);
}

/** Coerce/validate an inbound chat id the same way every crew route does. */
function parseChatId(raw: unknown): number | null {
  const chatId = Number(raw);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

/**
 * Sanitize a client `stars` payload into a bounded string[]. Drops non-strings,
 * empties, and absurdly long entries; caps the count so one request can't store
 * an unbounded set. The DO enforces the cap again (defense in depth).
 */
function sanitizeStars(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== 'string' || s.length === 0 || s.length > 200) continue;
    out.push(s);
    if (out.length >= 1000) break;
  }
  return out;
}

/**
 * POST /api/sync — upsert the acting user's roster row + stars for a crew.
 * The user id and display name come from the VERIFIED initData, never the body,
 * so a client can't sync on someone else's behalf.
 */
async function handleSync(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ initData?: string; chatId?: unknown; ghost?: unknown; stars?: unknown }>()
    .catch(() => null);
  const result = await verifyInitData(body?.initData ?? '', env.BOT_TOKEN);
  if (!result.ok || result.user === null) return json({ error: 'invalid initData' }, 401);
  const chatId = parseChatId(body?.chatId);
  if (chatId === null) return json({ error: 'invalid chatId' }, 400);
  // Privacy: `ghost` is a privacy control, so its ABSENCE must NEVER un-ghost an
  // existing ghost member (which would expose their stars via /api/roster). A
  // missing or malformed ghost is rejected — only an explicit boolean is accepted.
  if (typeof body?.ghost !== 'boolean') return json({ error: 'ghost must be a boolean' }, 400);
  // Data safety: a missing/non-array `stars` must NOT be coerced to [] — that
  // would silently WIPE an existing member's stars. Require an explicit array
  // (an empty [] is still valid: an intentional clear).
  if (!Array.isArray(body.stars)) return json({ error: 'stars must be an array' }, 400);
  const crew = env.CREW.getByName(String(chatId));
  await crew.syncMember(
    result.user.id,
    displayNameFor(result.user),
    body.ghost,
    sanitizeStars(body.stars),
  );
  return json({ ok: true });
}

/**
 * POST /api/roster — the crew roster for a chat. getRoster already redacts a
 * ghost member's plans server-side, so a ghost member's plans NEVER hit the wire.
 * NOTE: for this slice any valid initData user may read; gating the read to
 * actual crew members is a follow-up.
 */
async function handleRoster(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ initData?: string; chatId?: unknown }>().catch(() => null);
  const result = await verifyInitData(body?.initData ?? '', env.BOT_TOKEN);
  if (!result.ok) return json({ error: 'invalid initData' }, 401);
  const chatId = parseChatId(body?.chatId);
  if (chatId === null) return json({ error: 'invalid chatId' }, 400);
  const crew = env.CREW.getByName(String(chatId));
  return json({ roster: await crew.getRoster() });
}

/** POST /api/leave — remove the acting (verified) user from a crew. */
async function handleLeave(request: Request, env: Env): Promise<Response> {
  const body = await request
    .json<{ initData?: string; chatId?: unknown; cancelOwnEvents?: unknown }>()
    .catch(() => null);
  const result = await verifyInitData(body?.initData ?? '', env.BOT_TOKEN);
  if (!result.ok || result.user === null) return json({ error: 'invalid initData' }, 401);
  const chatId = parseChatId(body?.chatId);
  if (chatId === null) return json({ error: 'invalid chatId' }, 400);
  // The bgx.1 flag: default OFF. Leaving is pure privacy unless the user EXPLICITLY
  // opts to also cancel the events they own (still soft — shown as "[CANCELLED]").
  const cancelOwnEvents = body?.cancelOwnEvents === true;
  const crew = env.CREW.getByName(String(chatId));
  await crew.leaveCrew(result.user.id, { cancelOwnEvents });
  return json({ ok: true });
}

/** Pull the free-text custom-event fields out of a request body (never coords). */
type EventInput = {
  title?: string;
  day?: string | null;
  startIso?: string | null;
  endIso?: string | null;
  location?: string | null;
  notes?: string | null;
};

function eventInputFrom(body: {
  title?: unknown;
  day?: unknown;
  startIso?: unknown;
  endIso?: unknown;
  location?: unknown;
  notes?: unknown;
}): EventInput {
  const out: EventInput = {};
  if (typeof body.title === 'string') out.title = body.title;
  // For the rest: an ABSENT key stays absent (edit keeps existing); a present key
  // (string or otherwise) is passed through — the DO coerces non-strings to null.
  // Location is free text only — there is no map/coordinate field anywhere.
  const pass = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  if (body.day !== undefined) out.day = pass(body.day);
  if (body.startIso !== undefined) out.startIso = pass(body.startIso);
  if (body.endIso !== undefined) out.endIso = pass(body.endIso);
  if (body.location !== undefined) out.location = pass(body.location);
  if (body.notes !== undefined) out.notes = pass(body.notes);
  return out;
}

/** True if an RPC throw was the owner-only guard (→ maps to HTTP 403). */
function isOwnerMismatch(err: unknown): boolean {
  return err instanceof Error && err.message === 'not owner';
}

type EventBody = {
  initData?: string;
  chatId?: unknown;
  eventId?: unknown;
  title?: unknown;
  day?: unknown;
  startIso?: unknown;
  endIso?: unknown;
  location?: unknown;
  notes?: unknown;
  starred?: unknown;
};

/**
 * Resolve initData + chatId shared by every /api/events/* handler. Returns the
 * verified user id and the bound crew stub, or a ready-made error Response.
 */
async function eventContext(
  request: Request,
  env: Env,
): Promise<
  | { ok: true; body: EventBody; userId: number; crew: ReturnType<Env['CREW']['getByName']> }
  | { ok: false; res: Response }
> {
  const body = await request.json<EventBody>().catch(() => null);
  if (body === null) return { ok: false, res: json({ error: 'invalid body' }, 400) };
  const result = await verifyInitData(body.initData ?? '', env.BOT_TOKEN);
  if (!result.ok || result.user === null) {
    return { ok: false, res: json({ error: 'invalid initData' }, 401) };
  }
  const chatId = parseChatId(body.chatId);
  if (chatId === null) return { ok: false, res: json({ error: 'invalid chatId' }, 400) };
  return { ok: true, body, userId: result.user.id, crew: env.CREW.getByName(String(chatId)) };
}

/** POST /api/events/create — create a custom event owned by the verified user. */
async function handleEventCreate(request: Request, env: Env): Promise<Response> {
  const ctx = await eventContext(request, env);
  if (!ctx.ok) return ctx.res;
  const input = eventInputFrom(ctx.body);
  if (input.title === undefined || input.title.trim() === '') {
    return json({ error: 'title required' }, 400);
  }
  const event = await ctx.crew.createEvent(ctx.userId, input);
  return json({ event });
}

/** POST /api/events/edit — owner-only edit; owner mismatch → 403. */
async function handleEventEdit(request: Request, env: Env): Promise<Response> {
  const ctx = await eventContext(request, env);
  if (!ctx.ok) return ctx.res;
  const eventId = ctx.body.eventId;
  if (typeof eventId !== 'string' || eventId === '') return json({ error: 'invalid eventId' }, 400);
  try {
    const event = await ctx.crew.editEvent(ctx.userId, eventId, eventInputFrom(ctx.body));
    return json({ event });
  } catch (err) {
    if (isOwnerMismatch(err)) return json({ error: 'not owner' }, 403);
    return json({ error: err instanceof Error ? err.message : 'edit failed' }, 400);
  }
}

/** POST /api/events/cancel — owner-only soft cancel; owner mismatch → 403. */
async function handleEventCancel(request: Request, env: Env): Promise<Response> {
  const ctx = await eventContext(request, env);
  if (!ctx.ok) return ctx.res;
  const eventId = ctx.body.eventId;
  if (typeof eventId !== 'string' || eventId === '') return json({ error: 'invalid eventId' }, 400);
  try {
    await ctx.crew.cancelEvent(ctx.userId, eventId);
    return json({ ok: true });
  } catch (err) {
    if (isOwnerMismatch(err)) return json({ error: 'not owner' }, 403);
    return json({ error: err instanceof Error ? err.message : 'cancel failed' }, 400);
  }
}

/** POST /api/events/star — star/unstar an event as the verified user. */
async function handleEventStar(request: Request, env: Env): Promise<Response> {
  const ctx = await eventContext(request, env);
  if (!ctx.ok) return ctx.res;
  const eventId = ctx.body.eventId;
  if (typeof eventId !== 'string' || eventId === '') return json({ error: 'invalid eventId' }, 400);
  if (typeof ctx.body.starred !== 'boolean') return json({ error: 'starred must be a boolean' }, 400);
  try {
    if (ctx.body.starred) {
      await ctx.crew.starEvent(ctx.userId, eventId);
    } else {
      await ctx.crew.unstarEvent(ctx.userId, eventId);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'star failed' }, 400);
  }
}

/** POST /api/events/list — all custom events, with the viewer's star/owner view. */
async function handleEventList(request: Request, env: Env): Promise<Response> {
  const ctx = await eventContext(request, env);
  if (!ctx.ok) return ctx.res;
  return json({ events: await ctx.crew.listEvents(ctx.userId) });
}

// A tiny diagnostic page: opened as a Mini App, it reads the real
// Telegram.WebApp.initData and POSTs it to /api/resolve, showing ✅/❌ on screen.
// No secrets — it only resolves the opener's own initData. External Telegram
// script is fine here (served as a normal webview page, not a CSP'd artifact).
const RESOLVE_CHECK_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fur-Eh resolve check</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>body{font-family:system-ui,-apple-system,sans-serif;margin:0;padding:32px;background:#17120d;color:#f0e6d8}
h1{font-size:19px;font-weight:600}#status{font-size:56px;margin:20px 0}
pre{white-space:pre-wrap;word-break:break-word;background:#211a13;border:1px solid #3a2f22;padding:16px;border-radius:10px;font-size:14px;line-height:1.5}</style>
</head><body>
<h1>Fur-Eh — initData resolve check</h1>
<div id="status">…</div>
<pre id="out">running…</pre>
<script>
(function(){
  var out=document.getElementById('out'), st=document.getElementById('status');
  var tg=window.Telegram&&window.Telegram.WebApp; if(tg&&tg.ready)tg.ready();
  var initData=tg?tg.initData:'';
  if(!initData){st.textContent='⚠️';out.textContent='No initData — open this INSIDE Telegram as a Mini App, not in a normal browser.';return;}
  fetch('/api/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:initData})})
    .then(function(r){return r.json().then(function(d){return {status:r.status,ok:r.ok,body:d};});})
    .then(function(res){
      st.textContent=res.ok?'✅':'❌';
      out.textContent=(res.ok?'resolve OK':'resolve REJECTED')+' ('+res.status+')\\n'+JSON.stringify(res.body,null,2);
    })
    .catch(function(e){st.textContent='❌';out.textContent='error: '+e;});
})();
</script>
</body></html>`;

function handleResolveCheck(): Response {
  return new Response(RESOLVE_CHECK_HTML, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

/** Attach a crew to a group chat (and record admin status) from one update. */
async function applyUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const mcm = update.my_chat_member;
  if (mcm !== undefined && isGroupChat(mcm.chat)) {
    const chatId = mcm.chat.id;
    const status = mcm.new_chat_member.status;
    console.log(`my_chat_member chat=${chatId} status=${status}`);
    const crew = env.CREW.getByName(String(chatId));
    // Bot removed from the chat → stop the alarm and forget it (otherwise the
    // alarm keeps firing failing Telegram calls every 5 min forever).
    if (status === 'left' || status === 'kicked') {
      await crew.deactivate();
      return;
    }
    await crew.configure(chatId);
    await crew.setAdmin(status === 'administrator');
    // On promotion, post + silently pin the first digest right away (this is the
    // "the bot pins its next digest when made admin" behaviour, live).
    if (status === 'administrator') {
      await crew.postDigest(Date.now());
      console.log(`posted digest to chat=${chatId}`);
    }
    return;
  }
  const msg = update.message;
  if (msg !== undefined && isGroupChat(msg.chat)) {
    console.log(`message chat=${msg.chat.id}`);
    await env.CREW.getByName(String(msg.chat.id)).configure(msg.chat.id);
  }
}

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Fail CLOSED: a missing WEBHOOK_SECRET binding must not leave the webhook open
  // to forged updates.
  const expected = env.WEBHOOK_SECRET;
  if (
    expected === undefined ||
    expected === '' ||
    request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== expected
  ) {
    return new Response('forbidden', { status: 403 });
  }
  // Read the body BEFORE responding — the request stream can't be read once the
  // response is sent, so ONLY the slow Telegram API work goes into waitUntil.
  const update = await request.json<TelegramUpdate>().catch(() => null);
  if (update !== null) {
    ctx.waitUntil(
      applyUpdate(update, env).catch((err: unknown) => {
        console.error('applyUpdate error:', err instanceof Error ? err.message : err);
      }),
    );
  }
  return new Response(null, { status: 200 });
}

/**
 * One-shot setup: discover the group(s) the bot was added to via getUpdates
 * (only works before a webhook is set), configure a crew for each, then register
 * the webhook. All Bot API calls use the Worker's own BOT_TOKEN — the token
 * never leaves the server.
 */
async function handleSetup(request: Request, url: URL, env: Env): Promise<Response> {
  if (!bearerOk(request, env.SETUP_KEY)) return json({ error: 'forbidden' }, 403);
  // Registering a webhook without a secret would produce one the fail-closed
  // handler rejects — refuse rather than report a broken success.
  const webhookSecret = env.WEBHOOK_SECRET;
  if (webhookSecret === undefined || webhookSecret === '') {
    return json({ error: 'WEBHOOK_SECRET not configured' }, 503);
  }

  // getUpdates is the ONLY expected failure here (Telegram disables it once a
  // webhook is active); surface anything else instead of masking a real problem.
  let updates: TelegramUpdate[] = [];
  try {
    updates = await getUpdates(env.BOT_TOKEN);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (!/webhook is active/i.test(message)) {
      console.error('setup getUpdates failed:', message);
      return json({ error: 'setup: getUpdates failed' }, 502);
    }
  }

  // Keep each chat's LATEST membership status (updates are chronological), so an
  // "administrator" then "kicked" ends as kicked — never OR historical states.
  const latest = new Map<number, string>();
  for (const update of updates) {
    const mcm = update.my_chat_member;
    if (mcm !== undefined && isGroupChat(mcm.chat)) {
      latest.set(mcm.chat.id, mcm.new_chat_member.status);
    }
    const msg = update.message;
    if (msg !== undefined && isGroupChat(msg.chat) && !latest.has(msg.chat.id)) {
      latest.set(msg.chat.id, 'member');
    }
  }

  const configured: { chatId: number; admin: boolean }[] = [];
  for (const [chatId, status] of Array.from(latest.entries())) {
    const crew = env.CREW.getByName(String(chatId));
    if (status === 'left' || status === 'kicked') {
      await crew.deactivate();
      continue;
    }
    const admin = status === 'administrator';
    await crew.configure(chatId);
    await crew.setAdmin(admin);
    configured.push({ chatId, admin });
  }

  await setWebhook(env.BOT_TOKEN, `${url.origin}/telegram/webhook`, webhookSecret);
  return json({ configured, webhook: 'registered' });
}

/**
 * Admin/testing hook: force a crew's digest now, honoring `?now=` time-travel.
 * Guarded by the SETUP_KEY bearer — it can drive Telegram sends and rebind a
 * crew's chat, so it must never be open.
 */
async function handleTrigger(request: Request, url: URL, env: Env): Promise<Response> {
  if (!bearerOk(request, env.SETUP_KEY)) return json({ error: 'forbidden' }, 403);
  const crewId = url.searchParams.get('crew');
  if (crewId === null || crewId === '') return json({ error: 'crew query param required' }, 400);
  const crew = env.CREW.getByName(crewId);
  const chat = url.searchParams.get('chat');
  if (chat !== null) {
    const chatId = Number(chat);
    if (!Number.isSafeInteger(chatId)) return json({ error: 'invalid chat' }, 400);
    await crew.configure(chatId);
  }
  await crew.postDigest(effectiveNow(url).getTime());
  return json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const post = request.method === 'POST';

    if (pathname === '/api/health') return json({ ok: true });
    if (pathname === '/telegram/resolve-check' && request.method === 'GET') {
      return handleResolveCheck();
    }
    if (pathname === '/api/resolve' && post) return handleResolve(request, env);
    if (pathname === '/api/sync' && post) return handleSync(request, env);
    if (pathname === '/api/roster' && post) return handleRoster(request, env);
    if (pathname === '/api/leave' && post) return handleLeave(request, env);
    if (pathname === '/api/events/create' && post) return handleEventCreate(request, env);
    if (pathname === '/api/events/edit' && post) return handleEventEdit(request, env);
    if (pathname === '/api/events/cancel' && post) return handleEventCancel(request, env);
    if (pathname === '/api/events/star' && post) return handleEventStar(request, env);
    if (pathname === '/api/events/list' && post) return handleEventList(request, env);
    if (pathname === '/telegram/webhook' && post) return handleWebhook(request, env, ctx);
    if (pathname === '/telegram/setup' && post) return handleSetup(request, url, env);
    if (pathname === '/telegram/trigger' && post) return handleTrigger(request, url, env);

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
