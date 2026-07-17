import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// The trigger endpoint can drive Telegram sends and rebind a crew's chat, so it
// must be bearer-guarded and validate its inputs.
describe('POST /telegram/trigger', () => {
  it('rejects without the bearer key (fails closed)', async () => {
    const res = await SELF.fetch('https://example.com/telegram/trigger?crew=1', {
      method: 'POST',
    });
    expect(res.status).toBe(403);
  });

  it('400s when crew is missing', async () => {
    const res = await SELF.fetch('https://example.com/telegram/trigger', {
      method: 'POST',
      headers: { authorization: 'Bearer test-setup-key' },
    });
    expect(res.status).toBe(400);
  });

  it('400s on a non-integer chat', async () => {
    const res = await SELF.fetch(
      'https://example.com/telegram/trigger?crew=crew-x&chat=not-a-number',
      { method: 'POST', headers: { authorization: 'Bearer test-setup-key' } },
    );
    expect(res.status).toBe(400);
  });

  it('is ok for an unconfigured crew (no chat → no Telegram call)', async () => {
    const res = await SELF.fetch('https://example.com/telegram/trigger?crew=crew-unconfigured', {
      method: 'POST',
      headers: { authorization: 'Bearer test-setup-key' },
    });
    expect(res.status).toBe(200);
  });
});
