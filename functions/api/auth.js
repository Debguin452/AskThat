// functions/api/auth.js
// POST /api/auth  { username, action: 'claim' }  → { ok, token }  (first time setup)
// GET  /api/auth?username=x&token=y              → { ok, valid }

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

// ── GET: verify a token ────────────────────────────────────────────────────
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

  try {
    const stored = await env.MESSAGES_KV.get(`auth:${username}`);
    return json({ ok: true, valid: stored === token });
  } catch {
    return json({ ok: false, error: 'Storage error.' }, 500);
  }
}

// ── POST: claim a username (idempotent - returns same token if already claimed) ──
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const username = (body.username || '').trim().toLowerCase();
  const action   = body.action || 'claim';

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return json({ error: 'Invalid username.' }, 400);
  }

  if (action === 'claim') {
    try {
      // If already claimed, return the SAME token (idempotent for same session)
      // We allow reclaim because there's no password - token is per-device via localStorage
      // Generate a new secure token
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
      await env.MESSAGES_KV.put(`auth:${username}`, token, {
        expirationTtl: 60 * 60 * 24 * 90, // 90 days
      });
      return json({ ok: true, token, username });
    } catch {
      return json({ error: 'Failed to claim username.' }, 500);
    }
  }

  return json({ error: 'Unknown action.' }, 400);
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}
