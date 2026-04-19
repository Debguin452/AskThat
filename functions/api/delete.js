// functions/api/delete.js
// DELETE /api/delete

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestDelete(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Something went wrong. Try again.' }, 400); }

  const { username, id } = body ?? {};

  if (!username || !USERNAME_PATTERN.test(username) || username.length > 30) {
    return json({ error: 'That username does not look right.' }, 400);
  }

  if (!id || typeof id !== 'string' || id.length > 60) {
    return json({ error: 'Invalid message reference.' }, 400);
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];

  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch {
    return json({ error: 'Could not load messages.' }, 500);
  }

  const before = messages.length;
  messages = messages.filter((m) => m.id !== id);

  if (messages.length === before) {
    return json({ error: 'Message not found.' }, 404);
  }

  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(messages));
  } catch {
    return json({ error: 'Could not delete message. Try again.' }, 500);
  }

  return json({ success: true });
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
