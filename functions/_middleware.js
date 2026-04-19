// functions/_middleware.js

const ROUTE_LIMITS = {
  '/api/send':   { max: 8,  windowSecs: 60 },
  '/api/delete': { max: 30, windowSecs: 60 },
  '/api/pin':    { max: 40, windowSecs: 60 },
  '/api/stats':  { max: 60, windowSecs: 60 },
  '/api/get':    { max: 60, windowSecs: 60 },
  'default':     { max: 30, windowSecs: 60 },
};

const MAX_BODY_BYTES = 8192;
const BOT_UA_DENY = [/python-requests/i, /go-http-client/i, /scrapy/i, /httpclient/i, /libwww-perl/i, /wget\//i];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url   = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (!isApi) {
    return withSecurityHeaders(await next());
  }

  // Bot UA guard on mutating requests
  if (['POST', 'DELETE', 'PATCH'].includes(request.method)) {
    const ua = request.headers.get('User-Agent') || '';
    if (!ua || BOT_UA_DENY.some(r => r.test(ua))) {
      return apiError('Request blocked.', 403);
    }
  }

  // Body size guard
  if (request.method === 'POST') {
    const cl = parseInt(request.headers.get('Content-Length') || '0', 10);
    if (cl > MAX_BODY_BYTES) return apiError('Request body too large.', 413);
  }

  // Per-route IP rate limiting
  const ip   = getIP(request);
  const key  = Object.keys(ROUTE_LIMITS).find(k => url.pathname.startsWith(k)) || 'default';
  const limit = ROUTE_LIMITS[key];
  const rl   = await checkRateLimit(env, ip, url.pathname, limit);

  if (!rl.allowed) {
    return apiError('Too many requests — slow down.', 429, {
      'Retry-After':          String(limit.windowSecs),
      'X-RateLimit-Limit':    String(limit.max),
      'X-RateLimit-Remaining':'0',
      'X-RateLimit-Reset':    String(rl.resetAt),
    });
  }

  const resp = await next();
  const out  = new Headers(resp.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => out.set(k, v));
  Object.entries(securityHeaders()).forEach(([k, v]) => out.set(k, v));
  out.set('X-RateLimit-Limit', String(limit.max));
  out.set('X-RateLimit-Remaining', String(rl.remaining));

  return new Response(resp.body, { status: resp.status, headers: out });
}

async function checkRateLimit(env, ip, pathname, { max, windowSecs }) {
  const now    = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSecs);
  const key    = `rl2:${ip}:${pathname}:${bucket}`;
  let count    = 0;

  try { const v = await env.MESSAGES_KV.get(key); count = v ? parseInt(v, 10) : 0; } catch (_) {}
  if (count >= max) return { allowed: false, remaining: 0, resetAt: (bucket + 1) * windowSecs };
  try { await env.MESSAGES_KV.put(key, String(count + 1), { expirationTtl: windowSecs * 2 }); } catch (_) {}
  return { allowed: true, remaining: max - count - 1, resetAt: (bucket + 1) * windowSecs };
}

function getIP(r) {
  return r.headers.get('CF-Connecting-IP') || r.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'unknown';
}

function withSecurityHeaders(resp) {
  const h = new Headers(resp.headers);
  Object.entries(securityHeaders()).forEach(([k, v]) => h.set(k, v));
  return new Response(resp.body, { status: resp.status, headers: h });
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options':        'DENY',
    'X-XSS-Protection':       '1; mode=block',
    'Referrer-Policy':        'strict-origin-when-cross-origin',
    'Permissions-Policy':     'camera=(), microphone=(), geolocation=()',
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Max-Age':       '86400',
  };
}

function apiError(message, status, extra = {}) {
  return new Response(JSON.stringify({ error: message, status }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(), ...extra },
  });
}
