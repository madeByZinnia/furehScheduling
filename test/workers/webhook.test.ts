import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { Crew } from '../../src/worker/crew-do';

// Regression guard for the "read the body BEFORE responding" bug: the webhook
// used to defer request.json() into waitUntil, which throws "Can't read from
// request stream after response has been sent", so every update silently no-op'd.
// A group `message` update runs the same read-then-configure path with no
// outbound Telegram call, so it isolates the fix cleanly.

const GROUP_ID = -1009998887;

function messageBody(chatId: number) {
  return JSON.stringify({
    update_id: 1,
    message: { chat: { id: chatId, type: 'supergroup' } },
  });
}

function memberBody(chatId: number, status: string) {
  return JSON.stringify({
    update_id: 2,
    my_chat_member: {
      chat: { id: chatId, type: 'supergroup' },
      new_chat_member: { status },
    },
  });
}

async function postWebhook(body: string) {
  return SELF.fetch('https://example.com/telegram/webhook', {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
    body,
  });
}

describe('POST /telegram/webhook', () => {
  it('rejects a bad secret token', async () => {
    const res = await SELF.fetch('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
      body: messageBody(GROUP_ID),
    });
    expect(res.status).toBe(403);
  });

  it('reads the body and configures the crew (proves the stream is read pre-response)', async () => {
    const res = await SELF.fetch('https://example.com/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
      body: messageBody(GROUP_ID),
    });
    expect(res.status).toBe(200);

    // The crew DO learned its chat id from the parsed body — only possible if the
    // body was read before the response was sent. (No chat_id ⇒ the old bug.)
    const crew = env.CREW.getByName(String(GROUP_ID));
    await runInDurableObject(crew, (_instance: Crew, state) => {
      const rows = state.storage.sql
        .exec<{ chat_id: number | null }>('SELECT chat_id FROM crew_config WHERE id = 1')
        .toArray();
      expect(rows[0]?.chat_id).toBe(GROUP_ID);
    });
  });

  it('deactivates the crew (clears chat + alarm) when the bot is removed', async () => {
    const chatId = -1005550001;
    expect((await postWebhook(messageBody(chatId))).status).toBe(200); // configure + arm alarm
    expect((await postWebhook(memberBody(chatId, 'kicked'))).status).toBe(200); // removed

    const crew = env.CREW.getByName(String(chatId));
    await runInDurableObject(crew, async (_instance: Crew, state) => {
      const rows = state.storage.sql
        .exec<{ chat_id: number | null }>('SELECT chat_id FROM crew_config WHERE id = 1')
        .toArray();
      expect(rows[0]?.chat_id).toBeNull();
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});
