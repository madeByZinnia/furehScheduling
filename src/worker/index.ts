/**
 * Placeholder Worker entry — M2 backend (resolve/crew/DO/bot) not built yet.
 * Exists so wrangler + the vitest workers pool have a real target. For now it
 * only answers the health check; asset serving is handled by the static config.
 */
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};
