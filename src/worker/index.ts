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
  const expected = env.WEBHOOK_SECRET;
  if (
    expected !== undefined &&
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
  const key = env.SETUP_KEY;
  if (key !== undefined && request.headers.get('authorization') !== `Bearer ${key}`) {
    return json({ error: 'forbidden' }, 403);
  }

  const groups = new Map<number, boolean>(); // chatId → isAdmin
  try {
    for (const update of await getUpdates(env.BOT_TOKEN)) {
      const mcm = update.my_chat_member;
      if (mcm !== undefined && isGroupChat(mcm.chat)) {
        const admin = mcm.new_chat_member.status === 'administrator';
        groups.set(mcm.chat.id, (groups.get(mcm.chat.id) ?? false) || admin);
      }
      const msg = update.message;
      if (msg !== undefined && isGroupChat(msg.chat) && !groups.has(msg.chat.id)) {
        groups.set(msg.chat.id, false);
      }
    }
  } catch {
    // getUpdates fails once a webhook is active — fine on re-runs.
  }

  const configured: { chatId: number; admin: boolean }[] = [];
  for (const [chatId, admin] of Array.from(groups.entries())) {
    const crew = env.CREW.getByName(String(chatId));
    await crew.configure(chatId);
    await crew.setAdmin(admin);
    configured.push({ chatId, admin });
  }

  await setWebhook(env.BOT_TOKEN, `${url.origin}/telegram/webhook`, env.WEBHOOK_SECRET ?? '');
  return json({ configured, webhook: 'registered' });
}

/** Testing hook: force a crew's digest now, honoring `?now=` time-travel. */
async function handleTrigger(url: URL, env: Env): Promise<Response> {
  const crewId = url.searchParams.get('crew');
  if (crewId === null) return json({ error: 'crew query param required' }, 400);
  const crew = env.CREW.getByName(crewId);
  const chat = url.searchParams.get('chat');
  if (chat !== null) await crew.configure(Number(chat));
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
    if (pathname === '/telegram/trigger' && post) return handleTrigger(url, env);

    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
