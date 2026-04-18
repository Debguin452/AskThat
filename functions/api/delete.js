// functions/api/delete.js
// DELETE /api/delete  →  remove a specific message (body: {username, id})

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestDelete(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { username, id } = body ?? {};

  if (!username || !USERNAME_PATTERN.test(username)) {
    return json({ error: 'Invalid username.' }, 400);
  }

  if (!id || typeof id !== 'string' || id.length > 40) {
    return json({ error: 'Invalid message id.' }, 400);
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];

  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch {
    return json({ error: 'Failed to load messages.' }, 500);
  }

  const before = messages.length;
  messages = messages.filter((m) => m.id !== id);

  if (messages.length === before) {
    return json({ error: 'Message not found.' }, 404);
  }

  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(messages));
  } catch {
    return json({ error: 'Failed to delete message.' }, 500);
  }

  return json({ success: true });
}

export async function onRequest(context) {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
