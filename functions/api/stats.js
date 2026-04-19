// functions/api/stats.js  GET|POST /api/stats

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username || username.length > 30 || !USERNAME_RE.test(username)) {
    return json({ error: 'Invalid username.' }, 400);
  }

  let stats = { views: 0, received: 0, lastActive: null, activeCount: 0 };
  try {
    const raw = await env.MESSAGES_KV.get(`stats:${username.toLowerCase()}`);
    if (raw) stats = { ...stats, ...JSON.parse(raw) };
  } catch (_) {}

  try {
    const raw = await env.MESSAGES_KV.get(`msg:${username.toLowerCase()}`);
    if (raw) {
      const msgs = JSON.parse(raw);
      const now  = Date.now();
      stats.activeCount = msgs.filter(m => m.expiresAt > now).length;
      stats.unreadCount = msgs.filter(m => m.expiresAt > now && !m.read).length;
    }
  } catch (_) {}

  return json(stats);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request.' }, 400); }

  const { username, event } = body ?? {};

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }
  if (!['view'].includes(event)) {
    return json({ error: 'Invalid event.' }, 400);
  }

  try {
    const k   = `stats:${username.toLowerCase()}`;
    const raw = await env.MESSAGES_KV.get(k);
    const s   = raw ? JSON.parse(raw) : { views: 0, received: 0 };
    s.views   = (s.views || 0) + 1;
    await env.MESSAGES_KV.put(k, JSON.stringify(s), { expirationTtl: 30 * 86400 });
  } catch (_) {}

  return json({ success: true });
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
