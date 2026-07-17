import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A con-time instant so the digest logic has a stable "now" to reason about.
const CON_NOW = Date.parse('2026-07-18T13:05:00-06:00');

interface BotCall {
  method: string;
  body: Record<string, unknown>;
}

// Captured Telegram Bot API calls. The DO's telegram client calls global fetch,
// which we stub — no network in the pool, and we can assert exactly what was sent.
let calls: BotCall[];

function stubTelegramFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = urlStr.split('/').pop() ?? '';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ method, body });
    const sends = calls.filter((c) => c.method === 'sendMessage').length;
    const result: unknown = method === 'sendMessage' ? { message_id: 1000 + sends } : true;
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

function count(method: string): number {
  return calls.filter((c) => c.method === method).length;
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', stubTelegramFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Crew digest', () => {
  it('sends and (as admin) pins the first digest with disable_notification', async () => {
    const crew = env.CREW.getByName('crew-admin');
    await crew.configure(999);
    await crew.setAdmin(true);
    await crew.postDigest(CON_NOW);

    expect(count('sendMessage')).toBe(1);
    const pin = calls.find((c) => c.method === 'pinChatMessage');
    expect(pin).toBeDefined();
    expect(pin?.body.disable_notification).toBe(true);
  });

  it('does not pin when the bot is not an admin', async () => {
    const crew = env.CREW.getByName('crew-plain');
    await crew.configure(1);
    await crew.postDigest(CON_NOW);

    expect(count('sendMessage')).toBe(1);
    expect(count('pinChatMessage')).toBe(0);
  });

  it('a retry in the same bucket edits, never sends a second message', async () => {
    const crew = env.CREW.getByName('crew-retry');
    await crew.configure(1);
    await crew.postDigest(CON_NOW);
    await crew.postDigest(CON_NOW); // at-least-once retry, same 5-min bucket

    expect(count('sendMessage')).toBe(1);
    expect(count('editMessageText')).toBe(1);
  });

  it('SQL dedupe blocks a double-post even if the pinned id was not persisted', async () => {
    const crew = env.CREW.getByName('crew-crash');
    await crew.configure(1);
    await crew.postDigest(CON_NOW); // claims the bucket, sends #1

    // Simulate a crash between send and persisting pinned_message_id.
    await runInDurableObject(crew, (_instance, state) => {
      state.storage.sql.exec('UPDATE crew_config SET pinned_message_id = NULL WHERE id = 1');
    });

    await crew.postDigest(CON_NOW); // same bucket already claimed → must not send
    expect(count('sendMessage')).toBe(1);
  });

  it('does nothing until the crew is attached to a chat', async () => {
    const crew = env.CREW.getByName('crew-unconfigured');
    await crew.postDigest(CON_NOW);
    expect(calls.length).toBe(0);
  });
});

describe('Crew alarm', () => {
  it('re-arms itself and posts when fired', async () => {
    const crew = env.CREW.getByName('crew-alarm');
    await crew.configure(7); // arms the first alarm

    const ran = await runDurableObjectAlarm(crew);
    expect(ran).toBe(true);
    expect(count('sendMessage')).toBe(1);

    // alarm() re-armed at the start, so a future alarm is still pending.
    await runInDurableObject(crew, async (_instance, state) => {
      const next = await state.storage.getAlarm();
      expect(next).not.toBeNull();
    });
  });
});
