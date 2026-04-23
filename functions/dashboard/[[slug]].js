// functions/dashboard/[[slug]].js
// Serves dashboard.html after verifying ownership via cookie (+ optional IP check)

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

export async function onRequestGet({ request, env, params }) {
  const url     = new URL(request.url);
  const rawSlug = (params.slug || []).join('/');
  let username  = decodeURIComponent(rawSlug).split('/')[0].trim().toLowerCase();
  if (username.endsWith('.html')) username = username.slice(0, -5);

  // Validate username shape
  if (!username || username.length < 1 || username.length > 30 || !USERNAME_RE.test(username)) {
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  const cookieName    = `at_${username}`;
  const cookieToken   = parseCookie(request.headers.get('Cookie'), cookieName);
  const isFreshCreate = url.searchParams.get('u') === username;
  const requestIP     = getIP(request);

  let authToken    = null;
  let setCookieHdr = null;
  let isOwner      = false;

  // ── Path A: returning user — verify their cookie ──────────────────────
  if (cookieToken) {
    try {
      const raw    = await env.MESSAGES_KV.get(`auth:${username}`);
      const stored = raw ? JSON.parse(raw) : null;

      if (stored && stored.token === cookieToken) {
        authToken = cookieToken;
        isOwner   = true;

        // Soft IP check: if IP changed, still allow (mobile users roam)
        // but log it. For strict mode: uncomment the block below.
        // if (stored.ip && stored.ip !== 'unknown' && stored.ip !== requestIP) {
        //   return Response.redirect(new URL('/?blocked=1', url).toString(), 302);
        // }
      }
    } catch (_) {}
  }

  // ── Path B: fresh create — ?u=username present ────────────────────────
  if (!authToken && isFreshCreate) {
    try {
      const raw    = await env.MESSAGES_KV.get(`auth:${username}`);
      const stored = raw ? JSON.parse(raw) : null;

      if (!stored) {
        // Username not yet claimed — claim it now (fallback if auth POST was skipped)
        const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
        const entry = { token, ip: requestIP, createdAt: Date.now() };
        await env.MESSAGES_KV.put(`auth:${username}`, JSON.stringify(entry), {
          expirationTtl: 60 * 60 * 24 * 90,
        });
        authToken    = token;
        isOwner      = true;
        setCookieHdr = buildCookie(cookieName, token);
      } else if (stored.token) {
        // Already claimed by someone else → redirect home with taken message
        return Response.redirect(
          new URL(`/?taken=${encodeURIComponent(username)}`, url).toString(),
          302
        );
      }
    } catch (_) {
      return Response.redirect(new URL('/', url).toString(), 302);
    }
  }

  // ── If returning user and cookie matched but no Set-Cookie yet ────────
  if (isOwner && !setCookieHdr && !cookieToken) {
    // Edge case: they have the token but somehow lost the cookie — re-set it
    setCookieHdr = buildCookie(cookieName, authToken);
  }

  // ── No valid auth at all → block ──────────────────────────────────────
  if (!authToken) {
    // If they are visiting someone else's dashboard link → show the ask page
    const takenRaw = await env.MESSAGES_KV.get(`auth:${username}`).catch(() => null);
    if (takenRaw) {
      // Username exists — this visitor doesn't own it → redirect to their ask page
      return Response.redirect(new URL(`/ask/${username}`, url).toString(), 302);
    }
    // Username doesn't exist at all → send home
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  // ── Serve dashboard.html with injected context ─────────────────────────
  const assetUrl = new URL('/dashboard.html', url.origin);
  const res      = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), { headers: request.headers })
  );
  if (!res.ok) return res;

  let html = await res.text();
  const injection = `<script>
    window.__ASKTHAT_DASHBOARD_USER__ = ${JSON.stringify(username)};
    window.__ASKTHAT_TOKEN__          = ${JSON.stringify(authToken)};
    window.__ASKTHAT_IS_OWNER__       = true;
  </script>`;
  html = html.replace('</head>', injection + '\n</head>');

  const headers = {
    'Content-Type':  'text/html; charset=utf-8',
    'Cache-Control': 'no-store, private',
  };
  if (setCookieHdr) headers['Set-Cookie'] = setCookieHdr;

  return new Response(html, { status: 200, headers });
}

function buildCookie(name, token) {
  return `${name}=${token}; Path=/dashboard; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`;
}
