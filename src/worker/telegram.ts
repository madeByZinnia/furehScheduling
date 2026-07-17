/**
 * Telegram integration: initData HMAC verification (the auth gate) plus a tiny
 * Bot API client. We parse to structured data and never trust the input — a
 * tampered initData fails the HMAC and is rejected.
 *
 * The HMAC argument order is the classic trap. Telegram signs with a two-stage
 * HMAC-SHA256:
 *   secret       = HMAC(key = "WebAppData", msg = bot_token)
 *   expectedHash = HMAC(key = secret,       msg = data_check_string)
 * Swap the key/message and every signature still self-consistently "verifies"
 * but against the wrong construction, so the tests pin the order by asserting a
 * deliberately swapped-order signature is REJECTED.
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
  photo_url?: string;
}

export type InitDataResult =
  | { ok: true; user: TelegramUser | null; params: URLSearchParams }
  | { ok: false };

const encoder = new TextEncoder();

// initData is single-use at resolve time, so a day is a generous ceiling that
// still stops a captured blob from being replayed indefinitely.
const MAX_INITDATA_AGE_SEC = 86_400;
const MAX_FUTURE_SKEW_SEC = 300;

async function hmacSha256(keyData: BufferSource, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', key, encoder.encode(message));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare of two equal-length hex strings. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Telegram WebApp `initData` query string against the bot token.
 * Returns the parsed user on success, or `{ ok: false }` for any tamper or a
 * stale/missing `auth_date` (replay protection). `nowMs` is injectable for tests.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowMs: number = Date.now(),
): Promise<InitDataResult> {
  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  if (providedHash === null) return { ok: false };

  // data_check_string: every field except `hash`, sorted by key, `key=value`
  // pairs joined by newlines.
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'hash') pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secret = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const expectedHash = toHex(await hmacSha256(new Uint8Array(secret), dataCheckString));
  if (!timingSafeEqual(expectedHash, providedHash)) return { ok: false };

  // Replay protection: a validly-signed blob must also be recent. Reject a
  // missing / non-numeric / stale / far-future auth_date.
  const authDateRaw = params.get('auth_date');
  if (authDateRaw === null) return { ok: false };
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return { ok: false };
  const ageSec = nowMs / 1000 - authDate;
  if (ageSec > MAX_INITDATA_AGE_SEC || ageSec < -MAX_FUTURE_SKEW_SEC) return { ok: false };

  let user: TelegramUser | null = null;
  const userRaw = params.get('user');
  if (userRaw !== null) {
    try {
      user = JSON.parse(userRaw) as TelegramUser;
    } catch {
      user = null;
    }
  }
  return { ok: true, user, params };
}

/**
 * A crew reference derived from VERIFIED initData, tagged with whether the
 * source field is authorization-grade on its own (`trusted`) or merely a
 * user-choosable hint that still requires a membership check (`trusted:false`).
 */
export interface CrewRef {
  crewId: string;
  trusted: boolean;
}

/**
 * Derive a crew reference from the VERIFIED initData params. HMAC proves a field
 * was not tampered in transit, but that is NOT the same as authorization, so the
 * two crew-bearing fields carry different trust:
 *
 *   - `chat` is set by Telegram from the actual group the Mini App was opened in
 *     (an attachment-menu launch) — a group the launching user is really in — so
 *     it IS an authorization signal for that crew. → `{ trusted: true }`, no
 *     membership call needed.
 *   - `start_param` is USER-CHOSEN: anyone can open a crafted direct link
 *     (`startapp=<any crew id>`) and Telegram will legitimately sign that value.
 *     A valid HMAC on a user-controllable value proves nothing about
 *     authorization, so it MUST be membership-verified (getChatMember) before it
 *     is used as a Durable Object name. → `{ trusted: false }`.
 *
 * `chat` wins when both are present. Never trust a body-supplied chatId either —
 * only these signed values. Returns null when neither yields a safe-integer id.
 */
export function resolveCrewRef(params: URLSearchParams): CrewRef | null {
  const chatRaw = params.get('chat');
  if (chatRaw !== null) {
    try {
      const chat = JSON.parse(chatRaw) as { id?: unknown };
      // Telegram chat ids are safe integers. Reject fractional / unsafe /
      // precision-losing values that could alias another DO name.
      if (typeof chat.id === 'number' && Number.isSafeInteger(chat.id)) {
        // Attachment-menu launch: already an authorization signal.
        return { crewId: String(chat.id), trusted: true };
      }
    } catch {
      // Malformed chat JSON → fall through to start_param (never throw).
    }
  }
  const sp = params.get('start_param');
  if (sp !== null && sp !== '' && Number.isSafeInteger(Number(sp))) {
    // Direct-link launch: user-chosen, so untrusted — the caller MUST verify
    // membership (getChatMember) before acting on this crew.
    return { crewId: sp, trusted: false };
  }
  return null;
}

// ── Bot API client ─────────────────────────────────────────────────────────
// Thin wrappers over the HTTP Bot API. They call the global `fetch`, so tests
// stub `fetch` to assert calls without hitting the network.

const API_BASE = 'https://api.telegram.org';

interface BotResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface SentMessage {
  message_id: number;
}

async function callBot<T>(token: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json<BotResponse<T>>();
  if (!data.ok || data.result === undefined) {
    throw new Error(`Telegram ${method} failed: ${data.description ?? `HTTP ${res.status}`}`);
  }
  return data.result;
}

/** Raw `getChatMember` result fields we read (Telegram sends many more). */
interface ChatMemberResult {
  status: string; // 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'
  is_member?: boolean; // only meaningful for 'restricted'
}

/**
 * Ask Telegram whether `userId` is a member of `chatId`. Used to authorize a
 * direct-link (`start_param`) launch, where the crew id is user-chosen and thus
 * not authorization on its own.
 *
 * FAILS SOFT: on a non-ok Bot API response (e.g. chat/user not found, bot not in
 * the chat), a network error, or a malformed body we return
 * `{ status: 'error', isMember: false }` and NEVER throw — the caller treats
 * anything that is not a proven active membership as "deny" (fail closed).
 */
export async function getChatMember(
  token: string,
  chatId: number,
  userId: number,
): Promise<{ status: string; isMember: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/bot${token}/getChatMember`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
      // Bound the auth check: a hung Telegram connection must fail CLOSED (the
      // AbortError lands in the catch below → deny) rather than leave the
      // untrusted path pending.
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json<BotResponse<ChatMemberResult>>();
    if (!data.ok || data.result === undefined) {
      return { status: 'error', isMember: false };
    }
    return { status: data.result.status, isMember: data.result.is_member === true };
  } catch {
    // Network error / non-JSON body → deny, never throw.
    return { status: 'error', isMember: false };
  }
}

/**
 * True only for an ACTIVE membership: creator/administrator/member always, and a
 * 'restricted' member only while `is_member` is true (a restricted-but-still-in
 * user). Everything else — left, kicked, banned, our 'error' sentinel — is false,
 * so the untrusted direct-link path fails closed.
 */
export function isActiveMember(m: { status: string; isMember: boolean }): boolean {
  switch (m.status) {
    case 'creator':
    case 'administrator':
    case 'member':
      return true;
    case 'restricted':
      return m.isMember === true;
    default:
      return false;
  }
}

/**
 * A minimal inline-keyboard reply markup — just enough to carry url buttons (the
 * only kind the digest uses). Passed through verbatim to the Bot API.
 */
export interface InlineKeyboardMarkup {
  inline_keyboard: { text: string; url: string }[][];
}

/**
 * Send a message (HTML parse mode). Returns the new message id. When
 * `replyMarkup` is provided it is attached as the message's `reply_markup`;
 * omitting it leaves the request body byte-identical to a markup-less send.
 */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<number> {
  const result = await callBot<SentMessage>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    // Only include the key when a markup is supplied, so unset === omitted.
    ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
  });
  return result.message_id;
}

/**
 * Edit an existing message in place. Fires NO notification (that's the point).
 * When `replyMarkup` is provided it is attached; omitting it keeps the body
 * byte-identical to a markup-less edit.
 */
export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  try {
    await callBot<SentMessage>(token, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(replyMarkup !== undefined ? { reply_markup: replyMarkup } : {}),
    });
  } catch (err) {
    // Editing to identical text returns "message is not modified" — benign; the
    // pinned digest is already current, so treat it as success (and let the pin
    // retry that follows still run).
    if (err instanceof Error && err.message.includes('message is not modified')) return;
    throw err;
  }
}

/**
 * Pin a message. `disable_notification: true` is load-bearing — pinning
 * otherwise posts a "X pinned a message" service notification, which would
 * break the whole "the digest updates silently" promise.
 */
export async function pinChatMessage(
  token: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  await callBot<true>(token, 'pinChatMessage', {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: true,
  });
}

/** Register the webhook (used by scripts/set-webhook.ts once deployed). */
export async function setWebhook(token: string, url: string, secretToken: string): Promise<void> {
  await callBot<true>(token, 'setWebhook', {
    url,
    secret_token: secretToken,
    allowed_updates: ['message', 'my_chat_member'],
  });
}

// ── Update shapes (only the fields we read) ──────────────────────────────────

export interface TelegramChat {
  id: number;
  type: string; // 'private' | 'group' | 'supergroup' | 'channel'
}

export interface TelegramUpdate {
  update_id: number;
  message?: { chat: TelegramChat };
  my_chat_member?: { chat: TelegramChat; new_chat_member: { status: string } };
}

/**
 * Poll recent updates (long-poll disabled). Only usable while NO webhook is set
 * — Telegram rejects getUpdates once a webhook is active — so the setup flow
 * calls this first to discover the group, then registers the webhook.
 */
export async function getUpdates(token: string): Promise<TelegramUpdate[]> {
  return callBot<TelegramUpdate[]>(token, 'getUpdates', {
    allowed_updates: ['message', 'my_chat_member'],
  });
}
