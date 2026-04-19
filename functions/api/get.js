// functions/api/get.js  GET /api/get

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const PAGE_SIZE   = 20;

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = url.searchParams.get('username');
  const cursor   = Math.max(0, parseInt(url.searchParams.get('cursor') || '0', 10));
  const filter   = ['all','unread','pinned'].includes(url.searchParams.get('filter'))
                     ? url.searchParams.get('filter') : 'all';
  const sort     = url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const markRead = url.searchParams.get('markRead') === '1';

  if (!username || username.length > 30 || !USERNAME_RE.test(username)) {
    return json({ error: 'Invalid username.' }, 400);
  }

  const key = `msg:${username.toLowerCase()}`;
  let messages = [];
  try {
    const raw = await env.MESSAGES_KV.get(key);
    if (raw) messages = JSON.parse(raw);
  } catch { messages = []; }

  const now    = Date.now();
  let   active = messages.filter(m => m.expiresAt > now);

  // Mark page as read if requested
  if (markRead && filter === 'all') {
    let changed = false;
    active = active.map(m => { if (!m.read) { m.read = true; changed = true; } return m; });
    if (changed) {
      try { await env.MESSAGES_KV.put(key, JSON.stringify(active)); } catch (_) {}
    }
  } else if (active.length !== messages.length) {
    // Persist expiry cleanup
    try { await env.MESSAGES_KV.put(key, JSON.stringify(active)); } catch (_) {}
  }

  // Counts (before filter)
  const unreadCount = active.filter(m => !m.read).length;
  const pinnedCount = active.filter(m => m.pinned).length;

  // Apply filter
  let view = active;
  if (filter === 'unread') view = active.filter(m => !m.read);
  if (filter === 'pinned') view = active.filter(m => m.pinned);

  // Sort — pinned always float to top within their group
  view.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return sort === 'oldest' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
  });

  const total      = view.length;
  const page       = view.slice(cursor, cursor + PAGE_SIZE);
  const nextCursor = cursor + PAGE_SIZE < total ? cursor + PAGE_SIZE : null;

  // Poll results
  let pollStats = null;
  try {
    const rp = await env.MESSAGES_KV.get(`poll:${username.toLowerCase()}`);
    if (rp) pollStats = JSON.parse(rp);
  } catch (_) {}

  return json({
    messages:    page.map(m => ({
      id:             m.id,
      text:           m.text,
      timestamp:      m.timestamp,
      expiresAt:      m.expiresAt,
      revealIdentity: m.revealIdentity,
      read:           m.read,
      pinned:         m.pinned ?? false,
      poll:           m.poll ?? null,
    })),
    total,
    nextCursor,
    unreadCount,
    pinnedCount,
    pollStats,
  });
}

export async function onRequest() {
  return json({ error: 'Method not allowed.' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
