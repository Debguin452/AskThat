// functions/api/poll.js
// GET  /api/poll?username=x           → poll settings + vote totals (public)
// POST /api/poll  {username, answers} → submit anonymous vote
// PUT  /api/poll  {username, settings}→ owner saves poll config

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS   = 4;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

// ── GET: public — returns enabled state, questions, and aggregated vote counts ──
export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = (url.searchParams.get('username') || '').trim().toLowerCase();

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return err('Invalid username.', 400);
  }

  let cfg   = null;
  let votes = {};

  try {
    const raw = await env.MESSAGES_KV.get(`poll_cfg:${username}`);
    if (raw) cfg = JSON.parse(raw);
  } catch (_) {}

  if (!cfg || !cfg.enabled) {
    return json({ enabled: false });
  }

  try {
    const raw = await env.MESSAGES_KV.get(`poll_votes:${username}`);
    if (raw) votes = JSON.parse(raw);
  } catch (_) {}

  // Strip sensitive / internal fields, return public view
  return json({
    enabled:      true,
    title:        cfg.title   || 'Quick Poll',
    messagesOnly: Boolean(cfg.messagesOnly),
    questions:    (cfg.questions || []).map(q => ({
      id:      q.id,
      text:    q.text,
      options: q.options,
      counts:  votes[q.id] || {},
    })),
  });
}

// ── POST: submit a vote ─────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON.'); }

  const username = (body.username || '').trim().toLowerCase();
  const answers  = body.answers; // { questionId: "selected option" }

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return err('Invalid username.');
  }
  if (!answers || typeof answers !== 'object') {
    return err('Missing answers.');
  }

  // Fetch poll config to validate answers
  let cfg = null;
  try {
    const raw = await env.MESSAGES_KV.get(`poll_cfg:${username}`);
    if (raw) cfg = JSON.parse(raw);
  } catch (_) {}

  if (!cfg || !cfg.enabled) {
    return err('Poll is not enabled for this user.', 404);
  }

  // Load current votes
  let votes = {};
  try {
    const raw = await env.MESSAGES_KV.get(`poll_votes:${username}`);
    if (raw) votes = JSON.parse(raw);
  } catch (_) {}

  // Validate & tally each answer against configured questions
  let changed = false;
  for (const q of (cfg.questions || [])) {
    const selected = answers[q.id];
    if (selected && q.options.includes(selected)) {
      if (!votes[q.id]) votes[q.id] = {};
      votes[q.id][selected] = (votes[q.id][selected] || 0) + 1;
      changed = true;
    }
  }

  if (!changed) return err('No valid answers submitted.');

  try {
    await env.MESSAGES_KV.put(`poll_votes:${username}`, JSON.stringify(votes));
  } catch (_) {
    return err('Failed to save vote.', 500);
  }

  return json({ ok: true });
}

// ── PUT: owner saves poll settings ──────────────────────────────────────────
export async function onRequestPut({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON.'); }

  const username = (body.username || '').trim().toLowerCase();
  const settings = body.settings;

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return err('Invalid username.');
  }
  if (!settings || typeof settings !== 'object') {
    return err('Missing settings.');
  }

  const cfg = {
    enabled:      Boolean(settings.enabled),
    title:        String(settings.title || 'Quick Poll').slice(0, 80),
    messagesOnly: Boolean(settings.messagesOnly),
    questions:    [],
  };

  for (const q of (settings.questions || []).slice(0, MAX_QUESTIONS)) {
    if (!q.text || !Array.isArray(q.options)) continue;
    const opts = q.options
      .map(o => String(o).trim())
      .filter(o => o.length > 0)
      .slice(0, MAX_OPTIONS);
    if (opts.length < 2) continue;
    cfg.questions.push({
      id:      String(q.id || Math.random().toString(36).slice(2, 8)),
      text:    String(q.text).slice(0, 120),
      options: opts,
    });
  }

  try {
    await env.MESSAGES_KV.put(`poll_cfg:${username}`, JSON.stringify(cfg), {
      expirationTtl: 60 * 60 * 24 * 30, // 30 days
    });
  } catch (_) {
    return err('Failed to save settings.', 500);
  }

  return json({ ok: true, cfg });
}

export async function onRequestDelete() {
  return json({ error: 'Method not allowed.' }, 405);
}
