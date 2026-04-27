// functions/api/get.js  GET /api/get

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const PAGE_SIZE   = 20;
const VALID_MODES = ['ask','3words','trust','rate','hottake','advice','ai'];

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = url.searchParams.get('username');
  const field    = url.searchParams.get('field');

  if (!username || username.length > 30 || !USERNAME_RE.test(username)) {
    return json({ error: 'Invalid username.' }, 400);
  }

  // ── Field read (e.g. mode) ───────────────────────────────────────────────
  if (field === 'mode') {
    try {
      const raw = await env.MESSAGES_KV.get(`cfg:${username.toLowerCase()}`);
      const cfg = raw ? JSON.parse(raw) : {};
      return json({ mode: cfg.mode || 'ask' });
    } catch { return json({ mode: 'ask' }); }
  }

  const cursor   = Math.max(0, parseInt(url.searchParams.get('cursor') || '0', 10));
  const filter   = ['all','unread','pinned'].includes(url.searchParams.get('filter'))
                     ? url.searchParams.get('filter') : 'all';
  const sort     = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const markRead = url.searchParams.get('markRead') === '1';

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];
  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { messages = []; }

  const now    = Date.now();
  let   active = messages.filter(m => m.expiresAt > now);

  if (markRead && filter === 'all') {
    let changed = false;
    active = active.map(m => { if (!m.read) { m.read = true; changed = true; } return m; });
    if (changed) {
      try { await env.MESSAGES_KV.put(key, JSON.stringify(active)); } catch (_) {}
    }
  } else if (active.length !== messages.length) {
    try { await env.MESSAGES_KV.put(key, JSON.stringify(active)); } catch (_) {}
  }

  const unreadCount = active.filter(m => !m.read).length;
  const pinnedCount = active.filter(m => m.pinned).length;

  let view = active;
  if (filter === 'unread') view = active.filter(m => !m.read);
  if (filter === 'pinned') view = active.filter(m => m.pinned);

  view.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return sort === 'oldest' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
  });

  const total      = view.length;
  const page       = view.slice(cursor, cursor + PAGE_SIZE);
  const nextCursor = cursor + PAGE_SIZE < total ? cursor + PAGE_SIZE : null;

  let pollStats = null;
  try {
    const rp = await env.MESSAGES_KV.get(`poll:${username.toLowerCase()}`);
    if (rp) pollStats = JSON.parse(rp);
  } catch (_) {}

  // Attach saved mode to response for ask.html to pick up
  let savedMode = 'ask';
  try {
    const cfgRaw = await env.MESSAGES_KV.get(`cfg:${username.toLowerCase()}`);
    if (cfgRaw) savedMode = JSON.parse(cfgRaw).mode || 'ask';
  } catch(_) {}

  return json({
    messages: page.map(m => ({
      id: m.id, text: m.text, timestamp: m.timestamp, expiresAt: m.expiresAt,
      revealIdentity: m.revealIdentity, read: m.read,
      pinned: m.pinned ?? false, poll: m.poll ?? null,
    })),
    total, nextCursor, unreadCount, pinnedCount, pollStats, mode: savedMode,
  });
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error:'Invalid JSON.' }, 400); }

  const { username, token, field, value } = body;
  if (!username || !USERNAME_RE.test(username)) return json({ error:'Invalid username.' }, 400);

  // ── Save user config field ───────────────────────────────────────────────
  if (field === 'mode') {
    if (!VALID_MODES.includes(value)) return json({ error:'Invalid mode.' }, 400);
    const cfgKey = `cfg:${username.toLowerCase()}`;
    try {
      const raw = await env.MESSAGES_KV.get(cfgKey);
      const cfg = raw ? JSON.parse(raw) : {};
      cfg.mode = value;
      await env.MESSAGES_KV.put(cfgKey, JSON.stringify(cfg));
      return json({ ok: true, mode: value });
    } catch { return json({ error:'Save failed.' }, 500); }
  }

  return json({ error:'Unknown field.' }, 400);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
