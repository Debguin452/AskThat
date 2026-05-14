// functions/dashboard/[[slug]].js

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

function parseCookie(header, name) {
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === name) return decodeURIComponent(v.join('=').trim());
  }
  return null;
}

function getIP(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

function buildCookie(name, token) {
  return `${name}=${token}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`;
}

// Safely parse the stored auth entry — handles both old plain-string tokens
// and new JSON { token, ip, createdAt } format
function parseEntry(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {
    // Old format: plain token string
    return { token: raw, ip: null, createdAt: null };
  }
}

export async function onRequestGet({ request, env, params }) {
  const url     = new URL(request.url);
  const rawSlug = (params.slug || []).join('/');
  let username  = decodeURIComponent(rawSlug).split('/')[0].trim().toLowerCase();
  if (username.endsWith('.html')) username = username.slice(0, -5);

  if (!username || username.length < 1 || username.length > 30 || !USERNAME_RE.test(username)) {
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  const cookieName    = `at_${username}`;
  const cookieToken   = parseCookie(request.headers.get('Cookie'), cookieName);
  const isFreshCreate = url.searchParams.get('u') === username;
  const requestIP     = getIP(request);

  let authToken    = null;
  let setCookieHdr = null;

  // ── Read what's stored in KV ──────────────────────────────────────────
  let stored = null;
  try {
    const raw = await env.MESSAGES_KV.get(`auth:${username}`);
    stored = parseEntry(raw);
  } catch (_) {}

  // ── Path A: returning user with cookie ────────────────────────────────
  if (cookieToken && stored && stored.token === cookieToken) {
    authToken = cookieToken;
  }

  // ── Path B: fresh create (?u= present, no valid cookie yet) ──────────
  if (!authToken && isFreshCreate) {
    if (!stored) {
      // Username free — claim it now
      const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
      const entry = JSON.stringify({ token, ip: requestIP, createdAt: Date.now() });
      try {
        await env.MESSAGES_KV.put(`auth:${username}`, entry, { expirationTtl: 60*60*24*90 });
        authToken    = token;
        setCookieHdr = buildCookie(cookieName, token);
      } catch (_) {
        return Response.redirect(new URL('/', url).toString(), 302);
      }
    } else {
      // Entry exists. Two sub-cases:
      // B1: The user's own browser just claimed it (e.g. they refreshed).
      //     Cookie not set yet → the cookie is in Set-Cookie from prior response
      //     that the browser hasn't sent back. Check IP as weak signal.
      // B2: Actually taken by someone else.
      //
      // Since we cannot distinguish B1/B2 purely server-side without the cookie,
      // we return the "taken" page and let the user go home to try another name.
      return Response.redirect(
        new URL(`/?taken=${encodeURIComponent(username)}`, url).toString(),
        302
      );
    }
  }

  // ── No valid auth → block ─────────────────────────────────────────────
  if (!authToken) {
    if (stored) {
      // Username exists but visitor doesn't own it → send to ask page
      return Response.redirect(new URL(`/ask/${username}`, url).toString(), 302);
    }
    // Nothing here → home
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  // ── Serve dashboard ───────────────────────────────────────────────────
  const assetUrl = new URL('/dashboard.html', url.origin);
  let res;
  try {
    res = await env.ASSETS.fetch(new Request(assetUrl.toString(), { headers: request.headers }));
    if (!res.ok) return res;
  } catch (_) {
    return new Response('Dashboard unavailable', { status: 503 });
  }

  let html = await res.text();
  const injection = `<script>
window.__ASKTHAT_DASHBOARD_USER__ = ${JSON.stringify(username)};
window.__ASKTHAT_TOKEN__          = ${JSON.stringify(authToken)};
window.__ASKTHAT_IS_OWNER__       = true;
</script>`;
  html = html.replace('</head>', injection + '\n</head>');

  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private' };
  if (setCookieHdr) headers['Set-Cookie'] = setCookieHdr;

  return new Response(html, { status: 200, headers });
}
