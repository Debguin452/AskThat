const MAX_MSG_LEN       = 500;
const MAX_MSGS_PER_USER = 100;
const MSG_TTL_HOURS     = 168; // 7 days
const MAX_USERNAME_LEN  = 30;
const USERNAME_RE       = /^[a-zA-Z0-9_.-]+$/;

const VALID_VIBES = ['Hilarious','Mysterious','Wholesome','Chaotic'];
const VALID_KNOWS = ['Very well','Somewhat','Barely','Just lurking'];

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

  if (body._hp !== undefined && body._hp !== '') return json({ success:true, id:'ok' });

  const { username, text, message, poll } = body ?? {};

  if (!username || typeof username !== 'string' || username.length < 1 || username.length > MAX_USERNAME_LEN || !USERNAME_RE.test(username)) {
    return json({ error: 'Invalid username.' }, 400);
  }

  const trimmed = typeof (text || message) === 'string' ? (text || message).trim() : '';
  if (!trimmed)               return json({ error: 'Write something first.' }, 400);
  if (trimmed.length > MAX_MSG_LEN) return json({ error: `Keep it under ${MAX_MSG_LEN} characters.` }, 400);

  if (PROFANITY_RES.some(r => r.test(trimmed))) return json({ error: "Let's keep it civil." }, 422);
  if ((trimmed.match(/https?:\/\/\S+/gi) || []).length > 2) return json({ error: 'Too many links.' }, 422);
  if (/(.)\\1{14,}/.test(trimmed)) return json({ error: 'Try writing something meaningful.' }, 422);
  if (trimmed.length > 20) {
    const letters = (trimmed.match(/[a-zA-Z]/g) || []);
    const caps    = letters.filter(c => c === c.toUpperCase()).length;
    if (letters.length > 10 && caps/letters.length > 0.85) return json({ error: 'Ease up on the caps lock.' }, 422);
  }

  let pollData = null;
  if (poll && typeof poll === 'object') {
    const p = {};
    if (VALID_VIBES.includes(poll.vibe)) p.vibe = poll.vibe;
    if (VALID_KNOWS.includes(poll.know)) p.know = poll.know;
    if (Object.keys(p).length) pollData = p;
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];
  try { const raw = await env.MESSAGES_KV.get(key); if (raw) messages = JSON.parse(raw); } catch { messages = []; }

  const now    = Date.now();
  const active = messages.filter(m => m.expiresAt > now);

  // Fuzzy dedup — same or very similar text within 10 min
  const tenMin = now - 10 * 60_000;
  const isDup  = active.some(m => {
    if (m.timestamp <= tenMin) return false;
    return similarity(sanitise(trimmed), m.text) > 0.85;
  });
  if (isDup) return json({ error: 'This message was already sent recently.' }, 429);

  const capped = active.length >= MAX_MSGS_PER_USER ? active.slice(active.length - MAX_MSGS_PER_USER + 1) : active;

  // Geo signal — country code from Cloudflare (no PII, just country)
  const country = request.cf?.country || null;

  const newMsg = {
    id:        uid(),
    text:      sanitise(trimmed),
    timestamp: now,
    expiresAt: now + MSG_TTL_HOURS * 3_600_000,
    read:      false,
    pinned:    false,
    poll:      pollData,
    country,
  };

  capped.push(newMsg);
  try {
    await env.MESSAGES_KV.put(key, JSON.stringify(capped), { expirationTtl: MSG_TTL_HOURS * 3600 + 3600 });
  } catch { return json({ error: 'Could not send right now.' }, 500); }

  void recordPoll(env, username, pollData);
  void bumpStats(env, username, 'received', now);

  return json({ success: true, id: newMsg.id });
}

export async function onRequestGet() { return json({ error: 'Method not allowed.' }, 405); }

// Levenshtein similarity 0–1
function similarity(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const dp = Array.from({ length: la+1 }, (_, i) => Array.from({ length: lb+1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= la; i++) for (let j = 1; j <= lb; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return 1 - dp[la][lb] / Math.max(la, lb);
}

async function recordPoll(env, username, pollData) {
  if (!pollData) return;
  try {
    const k = `poll:${username.toLowerCase()}`;
    const raw = await env.MESSAGES_KV.get(k);
    const stats = raw ? JSON.parse(raw) : {};
    for (const [cat, val] of Object.entries(pollData)) {
      if (!stats[cat]) stats[cat] = {};
      stats[cat][val] = (stats[cat][val] || 0) + 1;
    }
    await env.MESSAGES_KV.put(k, JSON.stringify(stats), { expirationTtl: 7*86400 });
  } catch(_) {}
}

async function bumpStats(env, username, field, now) {
  try {
    const k = `stats:${username.toLowerCase()}`;
    const raw = await env.MESSAGES_KV.get(k);
    const s = raw ? JSON.parse(raw) : { views:0, received:0, streak:0, lastDay:0 };
    s[field] = (s[field] || 0) + 1;
    s.lastActive = now;
    // Streak logic — day bucket
    const today = Math.floor(now / 86400000);
    if (s.lastDay && today - s.lastDay === 1) s.streak = (s.streak || 0) + 1;
    else if (s.lastDay !== today) s.streak = 1;
    s.lastDay = today;
    await env.MESSAGES_KV.put(k, JSON.stringify(s), { expirationTtl: 30*86400 });
  } catch(_) {}
}

function sanitise(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`; }
function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json' } });
}
