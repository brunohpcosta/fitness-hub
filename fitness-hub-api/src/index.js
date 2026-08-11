/**
 * Fitness Hub API
 *
 * Two endpoints for now:
 *   GET /health  — open to anyone, confirms the Worker is alive
 *   everything else — requires the shared secret
 */

/**
 * Compares two strings in constant time.
 *
 * A normal === comparison stops at the first character that differs, so a wrong
 * guess starting with the right letter takes marginally longer to reject. Over
 * many attempts that timing difference leaks the secret one character at a time.
 * This version always checks every character.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Open endpoint — no secret needed. Lets you check the Worker is running
    // without exposing anything.
    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'fitness-hub-api',
        time: new Date().toISOString(),
      });
    }

    // If the secret was never configured, fail loudly rather than letting
    // everything through.
    if (!env.INGEST_SECRET) {
      return Response.json(
        { error: 'Server misconfigured: INGEST_SECRET is not set' },
        { status: 500 }
      );
    }

    const provided = request.headers.get('Authorization');
    const expected = `Bearer ${env.INGEST_SECRET}`;

    if (!safeEqual(provided, expected)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Past this line, the caller is authenticated.
    return Response.json({
      ok: true,
      message: 'Authenticated. Ingest endpoint arrives in Stage 2.',
      method: request.method,
      path: url.pathname,
    });
  },
};
