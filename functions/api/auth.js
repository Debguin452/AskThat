import { verifyToken, json } from './_shared.js';

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

// GET — verify a token (now uses shared verifyToken which handles JSON format)
export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = (url.searchParams.get('username') || '').trim().toLowerCase();
  const token    = (url.searchParams.get('token') || '').trim();

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ ok: false, error: 'Invalid username.' }, 400);
  }
  if (!token || token.length < 16) {
    return json({ ok: false, valid: false });
  }

  const result = await verifyToken(env, username, token);
  return json({ ok: result.ok, valid: result.ok });
}

// POST — claim is now handled entirely by the dashboard CF Function
// This endpoint is kept for compatibility but will always reject new claims
// (the CF Function is the only authorised path for creating an account)
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const username = (body.username || '').trim().toLowerCase();

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }

  try {
    const existing = await env.MESSAGES_KV.get(`auth:${username}`);
    if (existing) return json({ ok: false, error: 'Username already claimed.' }, 409);
  } catch {
    return json({ error: 'Storage error.' }, 500);
  }

  return json({ ok: false, error: 'Use the homepage to create your link.' }, 403);
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}
