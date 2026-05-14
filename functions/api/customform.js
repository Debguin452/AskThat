// functions/api/customform.js
// GET  /api/customform?username=               → public: fetch form config for visitors (ask page)
// GET  /api/customform?username=&token=        → owner: same but confirms ownership
// POST /api/customform                          → owner: save form config

const USERNAME_RE  = /^[a-zA-Z0-9_.-]+$/;
const VALID_TYPES  = ['text','textarea','yesno','choice','rating','number','scale'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyOwner(env, username, token) {
  if (!token) return false;
  try {
    const stored = await env.MESSAGES_KV.get(`auth:${username}`);
    return stored !== null && stored === token;
  } catch { return false; }
}

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const username = (url.searchParams.get('username') || '').toLowerCase().trim();
  const token    = url.searchParams.get('token') || '';

  if (!username || !USERNAME_RE.test(username) || username.length > 30)
    return json({ error: 'Invalid username.' }, 400);

  // If token provided, verify ownership (dashboard load)
  if (token) {
    const ok = await verifyOwner(env, username, token);
    if (!ok) return json({ error: 'Unauthorized.' }, 401);
  }

  try {
    const raw = await env.MESSAGES_KV.get(`customform:${username}`);
    if (!raw) return json({ form: null });
    const form = JSON.parse(raw);
    // Always return only the public-safe fields
    return json({
      form: {
        title:     form.title     || '',
        subtitle:  form.subtitle  || '',
        questions: form.questions || [],
      }
    });
  } catch {
    return json({ error: 'Storage error.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  const username = (body.username || '').toLowerCase().trim();
  const token    = (body.token    || '').trim();
  const form     = body.form;

  if (!username || !USERNAME_RE.test(username) || username.length > 30)
    return json({ error: 'Invalid username.' }, 400);

  const ok = await verifyOwner(env, username, token);
  if (!ok) return json({ error: 'Unauthorized.' }, 401);

  if (!form || typeof form !== 'object')
    return json({ error: 'Missing form data.' }, 400);

  const title    = String(form.title    || '').slice(0, 80).trim();
  const subtitle = String(form.subtitle || '').slice(0, 120).trim();
  const rawQs    = Array.isArray(form.questions) ? form.questions : [];

  if (!rawQs.length)   return json({ error: 'Add at least one question.' }, 400);
  if (rawQs.length > 10) return json({ error: 'Maximum 10 questions allowed.' }, 400);

  const questions = [];
  for (const q of rawQs) {
    const qtext = String(q.text || '').trim().slice(0, 160);
    if (!qtext) return json({ error: 'Every question needs text.' }, 400);
    if (!VALID_TYPES.includes(q.type)) return json({ error: `Invalid question type: ${q.type}` }, 400);

    const clean = {
      id:       String(q.id || `q_${Date.now()}_${Math.random().toString(36).slice(2,6)}`).slice(0, 60),
      text:     qtext,
      type:     q.type,
      required: Boolean(q.required),
    };

    if (q.type === 'choice') {
      const opts = Array.isArray(q.options)
        ? q.options.map(o => String(o).trim().slice(0, 80)).filter(Boolean)
        : [];
      if (opts.length < 2) return json({ error: 'Multiple choice needs at least 2 options.' }, 400);
      if (opts.length > 6) return json({ error: 'Maximum 6 options per question.' }, 400);
      clean.options = opts;
    }

    questions.push(clean);
  }

  const payload = { title, subtitle, questions, updatedAt: Date.now() };

  try {
    await env.MESSAGES_KV.put(`customform:${username}`, JSON.stringify(payload));
    return json({ ok: true });
  } catch {
    return json({ error: 'Storage error.' }, 500);
  }
}
