// functions/api/send.js  POST /api/send

const MAX_MSG_LEN      = 500;
const MAX_MSGS_PER_USER= 100;
const MSG_TTL_HOURS    = 48;
const MAX_USERNAME_LEN = 30;
const USERNAME_RE      = /^[a-zA-Z0-9_.-]+$/;

const VALID_VIBES = ['Hilarious', 'Mysterious', 'Wholesome', 'Chaotic'];
const VALID_KNOWS = ['Very well', 'Somewhat', 'Barely', 'Just lurking'];

const PROFANITY_RES = [
  /\bn[\s*@!1i]*[i1!*]+[g9q][g9q][e3][r]+\b/i,
  /\bf+[\s*]*u+[\s*]*c+[\s*]*k+/i,
  /\bs+[\s*]*h+[\s*]*i+[\s*]*t+/i,
  /\ba+[\s*]*s+[\s*]*s+[\s*]*h+[\s*]*o+[\s*]*l+[\s*]*e+/i,
  /\bb+[\s*]*i+[\s*]*t+[\s*]*c+[\s*]*h+/i,
  /\bk+[\s*]*i+[\s*]*l+[\s*]*l+[\s*]*y+[\s*]*o+[\s*]*u+[\s*]*r/i,
];

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid request format.' }, 400); }

  // Honeypot — bots fill hidden field; silently drop
  if (body._hp !== undefined && body._hp !== '') {
    return json({ success: true, id: 'ok' });
  }

  const { username, message, text, poll } = body ?? {};

  // Validate username
  if (!username || typeof username !== 'string' ||
      username.length < 1 || username.length > MAX_USERNAME_LEN ||
      !USERNAME_RE.test(username)) {
    return json({ error: 'Invalid username.' }, 400);
  }

  // Validate message (accept 'text' or 'message' field for compatibility)
  const trimmed = typeof (text || message) === 'string' ? (text || message).trim() : '';
  if (!trimmed) return json({ error: 'Write something first.' }, 400);
  if (trimmed.length > MAX_MSG_LEN) {
    return json({ error: `Keep it under ${MAX_MSG_LEN} characters.` }, 400);
  }

  // Profanity
  if (PROFANITY_RES.some(r => r.test(trimmed))) {
    return json({ error: "Let's keep it civil. Try rewording that." }, 422);
  }

  // URL spam (>2 links)
  if ((trimmed.match(/https?:\/\/\S+/gi) || []).length > 2) {
    return json({ error: 'Too many links — keep it personal.' }, 422);
  }

  // Repetition spam (14+ identical adjacent chars)
  if (/(.)\1{14,}/.test(trimmed)) {
    return json({ error: 'Try writing something meaningful.' }, 422);
  }

  // All-caps detection (>85% caps in 20+ char messages)
  if (trimmed.length > 20) {
    const letters = (trimmed.match(/[a-zA-Z]/g) || []);
    const caps    = letters.filter(c => c === c.toUpperCase()).length;
    if (letters.length > 10 && caps / letters.length > 0.85) {
      return json({ error: 'Ease up on the caps lock.' }, 422);
    }
  }

  // Validate poll payload
  let pollData = null;
  if (poll && typeof poll === 'object') {
    const p = {};
    if (VALID_VIBES.includes(poll.vibe)) p.vibe = poll.vibe;
    if (VALID_KNOWS.includes(poll.know)) p.know = poll.know;
    if (Object.keys(p).length) pollData = p;
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];
  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { messages = []; }

  const now    = Date.now();
  const active = messages.filter(m => m.expiresAt > now);

  // Duplicate guard — same sanitised text within last 5 min
  const fiveMin = now - 5 * 60_000;
  if (active.some(m => m.timestamp > fiveMin && m.text === sanitise(trimmed))) {
    return json({ error: 'This message was already sent recently.' }, 429);
  }

  // Cap inbox size
  const capped = active.length >= MAX_MSGS_PER_USER
    ? active.slice(active.length - MAX_MSGS_PER_USER + 1)
    : active;

  const newMsg = {
    id:        uid(),
    text:      sanitise(trimmed),
    timestamp: now,
    expiresAt: now + MSG_TTL_HOURS * 3_600_000,
    read:      false,
    pinned:    false,
    poll:      pollData,
  };

  capped.push(newMsg);

  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(capped), {
      expirationTtl: MSG_TTL_HOURS * 3600 + 3600,
    });
  } catch {
    return json({ error: 'Could not send right now. Try again.' }, 500);
  }

  // Async side-effects (don't block response)
  void recordPoll(env, username, pollData);
  void bumpStats(env, username, 'received', now);

  return json({ success: true, id: newMsg.id });
}

export async function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}

// ── Side-effects ─────────────────────────────────────────────────────────

async function recordPoll(env, username, pollData) {
  if (!pollData) return;
  try {
    const pollKey = `poll:${username.toLowerCase()}`;
    const raw     = await env.MESSAGES_KV.get(pollKey);
    const stats   = raw ? JSON.parse(raw) : {};
    for (const [cat, val] of Object.entries(pollData)) {
      if (!stats[cat]) stats[cat] = {};
      stats[cat][val] = (stats[cat][val] || 0) + 1;
    }
    await env.MESSAGES_KV.put(pollKey, JSON.stringify(stats), { expirationTtl: 7 * 86400 });
  } catch (_) {}
}

async function bumpStats(env, username, field, now) {
  try {
    const k    = `stats:${username.toLowerCase()}`;
    const raw  = await env.MESSAGES_KV.get(k);
    const s    = raw ? JSON.parse(raw) : { views: 0, received: 0 };
    s[field]   = (s[field] || 0) + 1;
    s.lastActive = now;
    await env.MESSAGES_KV.put(k, JSON.stringify(s), { expirationTtl: 30 * 86400 });
  } catch (_) {}
}

// ── Utils ─────────────────────────────────────────────────────────────────

function sanitise(str) {
  return str
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
