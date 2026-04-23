// functions/api/delete.js  DELETE /api/delete
import { verifyToken, json } from './_shared.js';

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestDelete({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request.' }, 400); }

  const { username, id, bulk, token } = body ?? {};

  if (!username || typeof username !== 'string' || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }

  // Verify ownership
  const auth = await verifyToken(env, username.toLowerCase(), token);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];
  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { return json({ error: 'Could not load messages.' }, 500); }

  const now    = Date.now();
  let   active = messages.filter(m => m.expiresAt > now);
  let   deleted = 0;

  if (bulk && Array.isArray(bulk) && bulk.length > 0) {
    const ids  = new Set(bulk.slice(0, 50).map(String));
    const prev = active.length;
    active     = active.filter(m => !ids.has(m.id));
    deleted    = prev - active.length;
  } else if (id && typeof id === 'string' && id.length <= 60) {
    const prev = active.length;
    active     = active.filter(m => m.id !== id);
    deleted    = prev - active.length;
    if (deleted === 0) return json({ error: 'Message not found.' }, 404);
  } else {
    return json({ error: 'Provide id or bulk array.' }, 400);
  }

  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(active));
  } catch {
    return json({ error: 'Could not delete. Try again.' }, 500);
  }

  return json({ success: true, deleted });
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}
