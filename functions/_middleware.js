// functions/_middleware.js
// Global middleware: rate limiting, security headers, CORS preflight

const RATE_LIMIT_MAX   = 10;   // max requests per window per IP
const RATE_WINDOW_SECS = 60;   // rolling window in seconds
const MAX_BODY_BYTES   = 4096; // max raw request body size

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // ── CORS pre-flight ───────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // ── Only apply heavy checks to /api/* routes ──────────────────
  if (url.pathname.startsWith('/api/')) {
    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
      'unknown';

    // ── Rate limiting (POST + DELETE only) ───────────────────────
    if (request.method === 'POST' || request.method === 'DELETE') {
      const now        = Math.floor(Date.now() / 1000);
      const window     = Math.floor(now / RATE_WINDOW_SECS);
      const rateKey    = `rate:${ip}:${window}`;

      let count = 0;
      try {
        const stored = await env.MESSAGES_KV.get(rateKey);
        count = stored ? parseInt(stored, 10) : 0;
      } catch (_) {}

      if (count >= RATE_LIMIT_MAX) {
        return errorResponse(
          'Too many requests. Please wait a minute.',
          429,
          { 'Retry-After': String(RATE_WINDOW_SECS) }
        );
      }

      try {
        await env.MESSAGES_KV.put(rateKey, String(count + 1), {
          expirationTtl: RATE_WINDOW_SECS * 2,
        });
      } catch (_) {}
    }

    // ── Body size guard for POST requests ────────────────────────
    if (request.method === 'POST') {
      const contentLength = parseInt(
        request.headers.get('Content-Length') || '0',
        10
      );
      if (contentLength > MAX_BODY_BYTES) {
        return errorResponse('Request body too large.', 413);
      }
    }
  }

  // ── Call next handler ─────────────────────────────────────────
  const response = await next();

  // ── Attach security headers to every response ─────────────────
  const newHeaders = new Headers(response.headers);
  Object.entries(securityHeaders()).forEach(([k, v]) => newHeaders.set(k, v));
  if (url.pathname.startsWith('/api/')) {
    Object.entries(corsHeaders()).forEach(([k, v]) => newHeaders.set(k, v));
  }

  return new Response(response.body, {
    status:  response.status,
    headers: newHeaders,
  });
}

// ── Helpers ───────────────────────────────────────────────────────
function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options':        'DENY',
    'X-XSS-Protection':       '1; mode=block',
    'Referrer-Policy':        'strict-origin-when-cross-origin',
  };
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function errorResponse(message, status, extra = {}) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extra,
    },
  });
}
