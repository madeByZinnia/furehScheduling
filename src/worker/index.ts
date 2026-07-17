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
  if (!result.ok) return json({ error: 'invalid initData' }, 401);
  return json({ accessCode: crypto.randomUUID(), user: result.user });
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
    if (pathname === '/api/resolve' && post) return handleResolve(request, env);
    if (pathname === '/telegram/webhook' && post) return handleWebhook(request, env, ctx);
    if (pathname === '/telegram/setup' && post) return handleSetup(request, url, env);
    if (pathname === '/telegram/trigger' && post) return handleTrigger(request, url, env);

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
