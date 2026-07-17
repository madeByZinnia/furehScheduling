/**
 * Register the Telegram webhook (Phase 4, run once after the first deploy):
 *   BOT_TOKEN=... WEBHOOK_SECRET=... npx tsx scripts/set-webhook.ts https://<worker>.workers.dev/telegram/webhook
 *
 * Self-contained on purpose (no worker imports) so it typechecks under the Node
 * config and needs nothing from the workerd runtime.
 */
export {}; // make this a module so top-level await is allowed

const token = process.env.BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET ?? '';
const url = process.argv[2];

if (token === undefined || token === '') {
  console.error('Set BOT_TOKEN in the environment first.');
  process.exit(1);
}
if (url === undefined) {
  console.error('Usage: npx tsx scripts/set-webhook.ts <https-webhook-url>');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url,
    secret_token: secret,
    allowed_updates: ['message', 'my_chat_member'],
  }),
});

console.log(`setWebhook → ${res.status}`);
console.log(await res.text());
