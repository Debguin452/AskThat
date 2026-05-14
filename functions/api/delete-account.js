// functions/api/delete-account.js  DELETE /api/delete-account
import { verifyToken, json } from './_shared.js';

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestDelete({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request.' }, 400); }

  const { username, token } = body ?? {};

  if (!username || typeof username !== 'string' || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }

  const u = username.toLowerCase();

  // Verify ownership
  const auth = await verifyToken(env, u, token);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  // Delete all KV keys for this account
  const keys = [
    `auth:${u}`,
    `msg:${u}`,
    `poll:cfg:${u}`,
    `poll:votes:${u}`,
  ];

  const errors = [];
  for (const key of keys) {
    try { await env.MESSAGES_KV.delete(key); }
    catch { errors.push(key); }
  }

  if (errors.length === keys.length) {
    return json({ error: 'Could not delete account. Please try again.' }, 500);
  }

  return json({ success: true });
}

export async function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}
