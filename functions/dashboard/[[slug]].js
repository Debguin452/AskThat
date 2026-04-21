const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

function parseCookie(header, name) {
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === name) return v.join('=').trim();
  }
  return null;
}

export async function onRequestGet({ request, env, params }) {
  const url      = new URL(request.url);
  const rawSlug  = (params.slug || []).join('/');
  let   username = decodeURIComponent(rawSlug).split('/')[0].trim().toLowerCase();
  if (username.endsWith('.html')) username = username.slice(0, -5);

  if (!username || username.length < 1 || username.length > 30 || !USERNAME_RE.test(username)) {
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  const cookieName     = `at_${username}`;
  const cookieToken    = parseCookie(request.headers.get('Cookie') || '', cookieName);
  const isFreshCreate  = url.searchParams.get('u') === username;

  let authToken    = null;
  let setCookieHdr = null;

  // Verify existing cookie
  if (cookieToken) {
    try {
      const stored = await env.MESSAGES_KV.get(`auth:${username}`);
      if (stored && stored === cookieToken) authToken = cookieToken;
    } catch (_) {}
  }

  // First time creation (?u=username in URL)
  if (!authToken && isFreshCreate) {
    try {
      const existing = await env.MESSAGES_KV.get(`auth:${username}`);
      if (!existing) {
        const token = crypto.randomUUID().replace(/-/g,'') + crypto.randomUUID().replace(/-/g,'');
        await env.MESSAGES_KV.put(`auth:${username}`, token, { expirationTtl: 60*60*24*90 });
        authToken    = token;
        setCookieHdr = `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7776000`;
      } else {
        // Already taken — send back home
        return Response.redirect(new URL(`/?taken=${encodeURIComponent(username)}`, url).toString(), 302);
      }
    } catch (_) {
      return Response.redirect(new URL('/', url).toString(), 302);
    }
  }

  // No valid auth at all — block
  if (!authToken) {
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  const assetUrl = new URL('/dashboard.html', url.origin);
  const res      = await env.ASSETS.fetch(new Request(assetUrl.toString(), { headers: request.headers }));
  if (!res.ok) return res;

  let html = await res.text();
  const injection = `<script>window.__ASKTHAT_DASHBOARD_USER__=${JSON.stringify(username)};window.__ASKTHAT_TOKEN__=${JSON.stringify(authToken)};</script>`;
  html = html.replace('</head>', injection + '\n</head>');

  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private' };
  if (setCookieHdr) headers['Set-Cookie'] = setCookieHdr;

  return new Response(html, { status: 200, headers });
}
