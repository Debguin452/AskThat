// functions/api/pin.js  POST /api/pin  — toggle pin on a message

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request.' }, 400); }

  const { username, id } = body ?? {};

  if (!username || typeof username !== 'string' || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }
  if (!id || typeof id !== 'string' || id.length > 60) {
    return json({ error: 'Invalid message id.' }, 400);
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];
  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { return json({ error: 'Could not load messages.' }, 500); }

  const now    = Date.now();
  const active = messages.filter(m => m.expiresAt > now);
  const target = active.find(m => m.id === id);

  if (!target) return json({ error: 'Message not found.' }, 404);

  target.pinned = !target.pinned;

  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(active));
  } catch {
    return json({ error: 'Could not update. Try again.' }, 500);
  }

  return json({ success: true, pinned: target.pinned });
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
