// functions/api/_shared.js — shared auth verifier used by mutating API routes

/**
 * Verify that the request's token matches the stored auth for this username.
 * Returns { ok: true } or { ok: false, error, status }
 */
export async function verifyToken(env, username, token) {
  if (!token || typeof token !== 'string' || token.length < 32) {
    return { ok: false, error: 'Missing or invalid auth token.', status: 401 };
  }
  try {
    const raw    = await env.MESSAGES_KV.get(`auth:${username}`);
    const stored = raw ? JSON.parse(raw) : null;
    if (!stored || stored.token !== token) {
      return { ok: false, error: 'Unauthorized. Open your dashboard to re-authenticate.', status: 403 };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Auth check failed.', status: 500 };
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
