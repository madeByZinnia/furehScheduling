import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Crew } from '../../src/worker/crew-do';

// The setup endpoint's Bot API calls (getUpdates, setWebhook) go through global
// fetch, which we stub. WEBHOOK_SECRET / SETUP_KEY come from the pool bindings.

const GROUP_ID = -1002003004;

interface StubCall {
  method: string;
  body: Record<string, unknown>;
}
let calls: StubCall[];

function stubFetch() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = urlStr.split('/').pop() ?? '';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ method, body });

    let result: unknown = true;
    if (method === 'getUpdates') {
      result = [
        {
          update_id: 1,
          my_chat_member: {
            chat: { id: GROUP_ID, type: 'supergroup' },
            new_chat_member: { status: 'administrator' },
          },
        },
      ];
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true, result }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', stubFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /telegram/setup', () => {
  it('rejects without the setup key', async () => {
    const res = await SELF.fetch('https://example.com/telegram/setup', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('discovers the group, configures the crew as admin, and registers the webhook', async () => {
    const res = await SELF.fetch('https://example.com/telegram/setup', {
      method: 'POST',
      headers: { authorization: 'Bearer test-setup-key' },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{
      configured: { chatId: number; admin: boolean }[];
      webhook: string;
    }>();
    expect(data.configured).toEqual([{ chatId: GROUP_ID, admin: true }]);
    expect(data.webhook).toBe('registered');

    // getUpdates was called before setWebhook, and the webhook URL is our origin.
    expect(calls.map((c) => c.method)).toEqual(['getUpdates', 'setWebhook']);
    const setWebhookCall = calls.find((c) => c.method === 'setWebhook');
    expect(setWebhookCall?.body.url).toBe('https://example.com/telegram/webhook');
    expect(setWebhookCall?.body.secret_token).toBe('test-webhook-secret');

    // The crew DO now knows its chat id and is flagged admin.
    const crew = env.CREW.getByName(String(GROUP_ID));
    await runInDurableObject(crew, (_instance: Crew, state) => {
      const row = state.storage.sql
        .exec<{ chat_id: number | null; is_admin: number }>(
          'SELECT chat_id, is_admin FROM crew_config WHERE id = 1',
        )
        .one();
      expect(row.chat_id).toBe(GROUP_ID);
      expect(row.is_admin).toBe(1);
    });
  });
});
