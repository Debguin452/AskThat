import { verifyToken, json } from './_shared.js';

const USERNAME_RE   = /^[a-zA-Z0-9_.-]+$/;
const MAX_QUESTIONS = 3;
const MAX_OPTIONS   = 4;

function err(msg, status = 400) { return json({ error: msg }, status); }

function getIP(r) {
  return r.headers.get('CF-Connecting-IP') ||
    r.headers.get('X-Forwarded-For')?.split(',')[0].trim() || 'unknown';
}

// GET — public: returns enabled state, questions, vote counts
export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = (url.searchParams.get('username') || '').trim().toLowerCase();

  if (!username || !USERNAME_RE.test(username) || username.length > 30) {
    return err('Invalid username.', 400);
  }

  let cfg = null;
  try { const r = await env.MESSAGES_KV.get(`poll_cfg:${username}`); if (r) cfg = JSON.parse(r); } catch (_) {}
  if (!cfg || !cfg.enabled) return json({ enabled: false });

  let votes = {};
  try { const r = await env.MESSAGES_KV.get(`poll_votes:${username}`); if (r) votes = JSON.parse(r); } catch (_) {}

  return json({
    enabled:   true,
    title:     cfg.title || 'Quick Poll',
    questions: (cfg.questions || []).map(q => ({
      id:      q.id,
      text:    q.text,
      options: q.options,
      counts:  votes[q.id] || {},
    })),
  });
}

// POST — submit an anonymous vote (one per IP per poll)
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON.'); }

  const username = (body.username || '').trim().toLowerCase();
  const answers  = body.answers;

  if (!username || !USERNAME_RE.test(username) || username.length > 30) return err('Invalid username.');
  if (!answers || typeof answers !== 'object') return err('Missing answers.');

  // One-vote-per-IP guard
  const ip      = getIP(request);
  const voteKey = `poll_voted:${username}:${ip}`;
  try {
    const already = await env.MESSAGES_KV.get(voteKey);
    if (already) return err('You have already voted on this poll.', 429);
  } catch (_) {}

  let cfg = null;
  try { const r = await env.MESSAGES_KV.get(`poll_cfg:${username}`); if (r) cfg = JSON.parse(r); } catch (_) {}
  if (!cfg || !cfg.enabled) return err('Poll not enabled.', 404);

  let votes = {};
  try { const r = await env.MESSAGES_KV.get(`poll_votes:${username}`); if (r) votes = JSON.parse(r); } catch (_) {}

  let changed = false;
  for (const q of (cfg.questions || [])) {
    const selected = answers[q.id];
    if (selected && q.options.includes(selected)) {
      if (!votes[q.id]) votes[q.id] = {};
      votes[q.id][selected] = (votes[q.id][selected] || 0) + 1;
      changed = true;
    }
  }
  if (!changed) return err('No valid answers.');

  try {
    await env.MESSAGES_KV.put(`poll_votes:${username}`, JSON.stringify(votes));
    // Record that this IP voted — expires in 365 days
    await env.MESSAGES_KV.put(voteKey, '1', { expirationTtl: 60 * 60 * 24 * 365 });
  } catch (_) {
    return err('Failed to save vote.', 500);
  }

  return json({ ok: true });
}

// PUT — owner saves poll settings (requires auth token)
export async function onRequestPut({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return err('Invalid JSON.'); }

  const username = (body.username || '').trim().toLowerCase();
  const settings = body.settings;
  const token    = body.token;

  if (!username || !USERNAME_RE.test(username) || username.length > 30) return err('Invalid username.');
  if (!settings || typeof settings !== 'object') return err('Missing settings.');

  const auth = await verifyToken(env, username, token);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const cfg = {
    enabled:   Boolean(settings.enabled),
    title:     String(settings.title || 'Quick Poll').slice(0, 80),
    questions: [],
  };

  for (const q of (settings.questions || []).slice(0, MAX_QUESTIONS)) {
    if (!q.text || !Array.isArray(q.options)) continue;
    const opts = q.options.map(o => String(o).trim()).filter(o => o.length > 0).slice(0, MAX_OPTIONS);
    if (opts.length < 2) continue;
    cfg.questions.push({
      id:      String(q.id || Math.random().toString(36).slice(2, 8)),
      text:    String(q.text).slice(0, 120),
      options: opts,
    });
  }

  try {
    await env.MESSAGES_KV.put(`poll_cfg:${username}`, JSON.stringify(cfg), {
      expirationTtl: 60 * 60 * 24 * 90,
    });
  } catch (_) { return err('Failed to save.', 500); }

  return json({ ok: true, cfg });
}

export async function onRequestDelete() { return json({ error: 'Method not allowed.' }, 405); }
