// functions/ask/[[slug]].js
// Handles /ask/username — injects username into ask.html so URL parsing is rock-solid

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestGet({ request, env, params }) {
  const url  = new URL(request.url);

  // Extract username from the catch-all slug
  const rawSlug = (params.slug || []).join('/');
  let username  = decodeURIComponent(rawSlug).split('/')[0].trim().toLowerCase();
  if (username.endsWith('.html')) username = username.slice(0, -5);

  // Validate
  const validUser = username && username.length >= 1 &&
                    username.length <= 30 && USERNAME_RE.test(username);

  // Fetch ask.html from the static assets
  const assetUrl = new URL('/ask.html', url.origin);
  const assetReq = new Request(assetUrl.toString(), { headers: request.headers });
  const res      = await env.ASSETS.fetch(assetReq);

  if (!res.ok) return res;

  let html = await res.text();

  // Inject username as a window variable before </head>
  // This is the most reliable method — no URL parsing needed
  const injection = `<script>window.__ASKTHAT_USER__=${JSON.stringify(validUser ? username : '')};</script>`;
  html = html.replace('</head>', injection + '\n</head>');

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
