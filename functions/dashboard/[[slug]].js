// functions/dashboard/[[slug]].js
// Handles /dashboard/username — injects username into dashboard.html server-side
// Same proven pattern as /ask/[[slug]].js — no URL parsing in the browser needed

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);

  // Extract username from the catch-all slug
  const rawSlug = (params.slug || []).join('/');
  let username  = decodeURIComponent(rawSlug).split('/')[0].trim().toLowerCase();
  if (username.endsWith('.html')) username = username.slice(0, -5);

  // Validate
  const validUser = username && username.length >= 1 &&
                    username.length <= 30 && USERNAME_RE.test(username);

  // If no valid user, redirect to home
  if (!validUser) {
    return Response.redirect(new URL('/', url).toString(), 302);
  }

  // Fetch dashboard.html from static assets
  const assetUrl = new URL('/dashboard.html', url.origin);
  const assetReq = new Request(assetUrl.toString(), { headers: request.headers });
  const res      = await env.ASSETS.fetch(assetReq);

  if (!res.ok) return res;

  let html = await res.text();

  // Inject username as a window variable — no browser URL parsing needed
  const injection = `<script>window.__ASKTHAT_DASHBOARD_USER__=${JSON.stringify(username)};</script>`;
  html = html.replace('</head>', injection + '\n</head>');

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
