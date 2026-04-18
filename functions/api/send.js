// functions/api/send.js
// POST /api/send  →  store an anonymous message for a username

const MAX_MSG_LEN          = 500;
const MAX_MSGS_PER_USER    = 100;
const MSG_TTL_HOURS        = 48;
const MAX_USERNAME_LEN     = 30;
const USERNAME_PATTERN     = /^[a-zA-Z0-9_.-]+$/;

// ── Profanity filter (extend as needed) ──────────────────────────
const BLOCKED_PATTERNS = [
  /\bn[\s*@!1i]*[i1!*]+[g9q][g9q][e3][r]+\b/i,
  /\bf+[\s*]*u+[\s*]*c+[\s*]*k+/i,
  /\bs+[\s*]*h+[\s*]*i+[\s*]*t+/i,
  /\ba+[\s*]*s+[\s*]*s+[\s*]*h+[\s*]*o+[\s*]*l+[\s*]*e+/i,
  /\bb+[\s*]*i+[\s*]*t+[\s*]*c+[\s*]*h+/i,
];

function containsProfanity(text) {
  return BLOCKED_PATTERNS.some((re) => re.test(text));
}

// Very minimal HTML-entity sanitise (we store sanitised text; display raw)
function sanitise(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function generateId() {
  const ts  = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rnd}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Parse body ────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const { username, message, revealIdentity = false } = body ?? {};

  // ── Validate username ─────────────────────────────────────────
  if (
    !username ||
    typeof username !== 'string' ||
    username.length < 1 ||
    username.length > MAX_USERNAME_LEN ||
    !USERNAME_PATTERN.test(username)
  ) {
    return json(
      { error: 'Invalid username. Use letters, numbers, _ . - only.' },
      400
    );
  }

  // ── Validate message ──────────────────────────────────────────
  if (!message || typeof message !== 'string') {
    return json({ error: 'Message is required.' }, 400);
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return json({ error: 'Message cannot be empty.' }, 400);
  }

  if (trimmed.length > MAX_MSG_LEN) {
    return json(
      { error: `Message too long. Maximum ${MAX_MSG_LEN} characters.` },
      400
    );
  }

  // ── Profanity check ───────────────────────────────────────────
  if (containsProfanity(trimmed)) {
    return json(
      { error: 'Message contains inappropriate content.' },
      422
    );
  }

  // ── Load existing messages ────────────────────────────────────
  const key = `msg:${username.toLowerCase()}`;
  let messages = [];

  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch {
    messages = [];
  }

  // ── Expire old messages ───────────────────────────────────────
  const now = Date.now();
  messages = messages.filter((m) => m.expiresAt > now);

  // ── Enforce per-user cap (drop oldest) ───────────────────────
  if (messages.length >= MAX_MSGS_PER_USER) {
    messages = messages.slice(messages.length - MAX_MSGS_PER_USER + 1);
  }

  // ── Build new message object ──────────────────────────────────
  const ip = (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    '0.0.0.0'
  );

  // Mask last octet for optional identity hint
  const ipHint = ip.includes('.')
    ? ip.split('.').slice(0, 3).join('.') + '.***'
    : ip.slice(0, -4) + '****';

  const newMsg = {
    id:             generateId(),
    text:           sanitise(trimmed),
    timestamp:      now,
    expiresAt:      now + MSG_TTL_HOURS * 3_600_000,
    revealIdentity: Boolean(revealIdentity),
    ipHint:         revealIdentity ? ipHint : null,
    read:           false,
  };

  messages.push(newMsg);

  // ── Persist ───────────────────────────────────────────────────
  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(messages));
  } catch (err) {
    return json({ error: 'Failed to save message. Try again.' }, 500);
  }

  return json({ success: true, id: newMsg.id });
}

// ── Handle wrong methods ──────────────────────────────────────────
export async function onRequest(context) {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
