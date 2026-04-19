// functions/api/get.js
// GET /api/get?username=…

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url      = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username || username.length > 30 || !USERNAME_PATTERN.test(username)) {
    return json({ error: 'That username does not look right.' }, 400);
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];

  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { messages = []; }

  const now    = Date.now();
  const active = messages.filter((m) => m.expiresAt > now);

  // Persist back only if messages were cleaned up
  if (active.length !== messages.length) {
    try {
      await env.MESSAGES_KV.put(key, JSON.stringify(active));
    } catch (_) {}
  }

  const sorted = [...active]
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((m) => ({
      id:             m.id,
      text:           m.text,
      timestamp:      m.timestamp,
      expiresAt:      m.expiresAt,
      revealIdentity: m.revealIdentity,
      read:           m.read,
    }));

  return json({ messages: sorted, total: sorted.length });
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
