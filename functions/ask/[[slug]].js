const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;

export async function onRequestGet({ request, env, params }) {
  const url      = new URL(request.url);
  const rawSlug  = (params.slug || []).join('/');
  let   username = decodeURIComponent(rawSlug).split('/')[0].trim().toLowerCase();
  if (username.endsWith('.html')) username = username.slice(0, -5);

  const validUser = username && username.length >= 1 &&
                    username.length <= 30 && USERNAME_RE.test(username);

  const assetUrl = new URL('/ask.html', url.origin);
  const res      = await env.ASSETS.fetch(new Request(assetUrl.toString(), { headers: request.headers }));
  if (!res.ok) return res;

  let html = await res.text();

  const userLabel = validUser ? username : 'someone';
  const pageUrl   = `${url.origin}/ask/${validUser ? username : ''}`;
  const ogImg     = `${url.origin}/icon-512x512.png`;

  html = html
    .replace('content="Ask me anonymously — AskThat"',
             `content="Ask ${userLabel} anonymously — AskThat"`)
    .replace('<meta property="og:type" content="website">',
             `<meta property="og:type" content="website">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${ogImg}">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:image" content="${ogImg}">`)
    .replace('</head>',
             `<script>window.__ASKTHAT_USER__=${JSON.stringify(validUser ? username : '')};</script>\n</head>`);

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
