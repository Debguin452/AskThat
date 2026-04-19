// functions/api/send.js
// POST /api/send

const MAX_MSG_LEN       = 500;
const MAX_MSGS_PER_USER = 100;
const MSG_TTL_HOURS     = 48;
const MAX_USERNAME_LEN  = 30;
const USERNAME_PATTERN  = /^[a-zA-Z0-9_.-]+$/;

const BLOCKED_PATTERNS = [
  /\bn[\s*@!1i]*[i1!*]+[g9q][g9q][e3][r]+\b/i,
  /\bf+[\s*]*u+[\s*]*c+[\s*]*k+/i,
  /\bs+[\s*]*h+[\s*]*i+[\s*]*t+/i,
  /\ba+[\s*]*s+[\s*]*s+[\s*]*h+[\s*]*o+[\s*]*l+[\s*]*e+/i,
  /\bb+[\s*]*i+[\s*]*t+[\s*]*c+[\s*]*h+/i,
  /\bk+[\s*]*i+[\s*]*l+[\s*]*l+[\s*]*y+[\s*]*o+[\s*]*u+[\s*]*r/i,
];

function containsProfanity(text) {
  return BLOCKED_PATTERNS.some((re) => re.test(text));
}

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
  const rnd = Math.random().toString(36).slice(2, 9);
  return `${ts}-${rnd}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Hmm, try writing something else.' }, 400); }

  const { username, message, revealIdentity = false } = body ?? {};

  if (
    !username ||
    typeof username !== 'string' ||
    username.length < 1 ||
    username.length > MAX_USERNAME_LEN ||
    !USERNAME_PATTERN.test(username)
  ) {
    return json({ error: 'That username does not look right.' }, 400);
  }

  if (!message || typeof message !== 'string') {
    return json({ error: 'Write something first.' }, 400);
  }

  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return json({ error: 'Write something first.' }, 400);
  }

  if (trimmed.length > MAX_MSG_LEN) {
    return json({ error: `That is a bit too long — keep it under ${MAX_MSG_LEN} characters.` }, 400);
  }

  if (containsProfanity(trimmed)) {
    return json({ error: "Let's keep it civil. Try rewording that." }, 422);
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];

  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { messages = []; }

  const now = Date.now();
  messages = messages.filter((m) => m.expiresAt > now);

  if (messages.length >= MAX_MSGS_PER_USER) {
    messages = messages.slice(messages.length - MAX_MSGS_PER_USER + 1);
  }

  const newMsg = {
    id:             generateId(),
    text:           sanitise(trimmed),
    timestamp:      now,
    expiresAt:      now + MSG_TTL_HOURS * 3_600_000,
    revealIdentity: Boolean(revealIdentity),
    read:           false,
  };

  messages.push(newMsg);

  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(messages), {
      expirationTtl: MSG_TTL_HOURS * 3600 + 3600,
    });
  } catch {
    return json({ error: 'Could not send right now. Try again.' }, 500);
  }

  return json({ success: true, id: newMsg.id });
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
