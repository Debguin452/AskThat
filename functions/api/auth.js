// functions/api/auth.js
// POST { username, action:'check' }  → { ok:true, free:bool }      (read-only check)
// POST { username, action:'claim' }  → { ok:true, token } | { ok:false, taken:true }
// GET  ?username=x&token=y           → { ok:true, valid:bool }

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

function getIP(r) {
  return r.headers.get('CF-Connecting-IP') ||
         r.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
         'unknown';
}

function parseEntry(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (_) { return { token: raw, ip: null, createdAt: null }; } // old plain-string format
}

// ── GET: verify token ─────────────────────────────────────────────────────
export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = (url.searchParams.get('username') || '').trim().toLowerCase();
  const token    = (url.searchParams.get('token') || '').trim();

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ ok: false, error: 'Invalid username.' }, 400);
  }
  if (!token || token.length < 16) return json({ ok: false, valid: false });

  try {
    const raw    = await env.MESSAGES_KV.get(`auth:${username}`);
    const stored = parseEntry(raw);
    return json({ ok: true, valid: !!(stored && stored.token === token) });
  } catch {
    return json({ ok: false, error: 'Storage error.' }, 500);
  }
}

// ── POST: check or claim ──────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const username = (body.username || '').trim().toLowerCase();
  const action   = body.action || 'check';

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }

  let raw, stored;
  try {
    raw    = await env.MESSAGES_KV.get(`auth:${username}`);
    stored = parseEntry(raw);
  } catch {
    return json({ error: 'Storage error. Try again.' }, 500);
  }

  // ── action: check (read-only — just tells caller if name is free) ─────
  if (action === 'check') {
    return json({ ok: true, free: !stored });
  }

  // ── action: claim ────────────────────────────────────────────────────
  if (action === 'claim') {
    if (stored) {
      // Already taken by someone
      return json({ ok: false, taken: true, error: 'Username already taken.' }, 409);
    }

    try {
      const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
      const entry = JSON.stringify({ token, ip: getIP(request), createdAt: Date.now() });
      await env.MESSAGES_KV.put(`auth:${username}`, entry, { expirationTtl: 60*60*24*90 });
      return json({ ok: true, token, username });
    } catch {
      return json({ error: 'Failed to claim. Try again.' }, 500);
    }
  }

  return json({ error: 'Unknown action.' }, 400);
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}
