const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.1-8b-instant';

function json(data, s=200) {
  return new Response(JSON.stringify(data), { status:s, headers:{'Content-Type':'application/json'} });
}

async function groq(env, messages, maxTokens=200) {
  const res = await fetch(GROQ_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({ model:MODEL, max_tokens:maxTokens, messages }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}`);
  const d = await res.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const type     = url.searchParams.get('type');
  const username = (url.searchParams.get('username') || 'them').trim().toLowerCase();

  // ── AI-generated placeholders for textarea ─────────────────────────────
  if (type === 'placeholders') {
    const cacheKey = `groq_ph:${username}`;
    try { const c = await env.MESSAGES_KV.get(cacheKey); if (c) return json({ placeholders: JSON.parse(c) }); } catch(_) {}
    if (!env.GROQ_API_KEY) return json({ placeholders: defaultPlaceholders() });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:'Generate 5 short anonymous message prompts for an anonymous Q&A app. Return ONLY a JSON array of 5 strings, each under 80 characters. Varied tones: curious, playful, honest, deep, funny. No quotes inside strings.'
      },{ role:'user', content:`For a person named "${username}". JSON array only.` }], 250);
      let ph;
      try { ph = JSON.parse(raw.replace(/```json|```/g,'').trim()); if (!Array.isArray(ph)||ph.length<3) throw 0; ph=ph.slice(0,5).map(p=>String(p).slice(0,100)); }
      catch { ph = defaultPlaceholders(); }
      try { await env.MESSAGES_KV.put(cacheKey, JSON.stringify(ph), { expirationTtl:3600 }); } catch(_) {}
      return json({ placeholders: ph });
    } catch { return json({ placeholders: defaultPlaceholders() }); }
  }

  // ── AI game ──────────────────────────────────────────────────────────────
  if (type === 'game') {
    const cacheKey = `groq_game:${username}`;
    try { const c = await env.MESSAGES_KV.get(cacheKey); if (c) return json({ game: c }); } catch(_) {}
    if (!env.GROQ_API_KEY) return json({ game: randomFallbackGame() });
    try {
      const raw = await groq(env, [{ role:'system', content:'Write a single short viral anonymous game/challenge for a social app. Max 12 words. No quotes.' },{ role:'user', content:`Game for "${username}".` }], 50);
      const game = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,90) || randomFallbackGame();
      try { await env.MESSAGES_KV.put(cacheKey, game, { expirationTtl:14400 }); } catch(_) {}
      return json({ game });
    } catch { return json({ game: randomFallbackGame() }); }
  }

  // ── Name dare ─────────────────────────────────────────────────────────────
  if (type === 'dare') {
    const cacheKey = `groq_dare:${username}`;
    try { const c = await env.MESSAGES_KV.get(cacheKey); if (c) return json({ dare: c }); } catch(_) {}
    if (!env.GROQ_API_KEY) return json({ dare: randomFallbackDare(username) });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:`Write a single spicy/controversial question that visitors answer ABOUT a person — their friends will love answering it anonymously. Be specific to their name. Max 12 words. No quotes in output.`
      },{ role:'user', content:`Name dare for "${username}".` }], 50);
      const dare = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,100) || randomFallbackDare(username);
      try { await env.MESSAGES_KV.put(cacheKey, dare, { expirationTtl:21600 }); } catch(_) {}
      return json({ dare });
    } catch { return json({ dare: randomFallbackDare(username) }); }
  }

  // ── AI prompt ─────────────────────────────────────────────────────────────
  if (type === 'prompt') {
    const cacheKey = `groq_prompt:${username}`;
    try { const c = await env.MESSAGES_KV.get(cacheKey); if (c) return json({ prompt: c }); } catch(_) {}
    if (!env.GROQ_API_KEY) return json({ prompt: randomFallbackPrompt() });
    try {
      const raw = await groq(env, [{ role:'system', content:'Write a single fun anonymous question for followers. Max 10 words. No quotes.' },{ role:'user', content:`Question for "${username}".` }], 40);
      const prompt = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,80) || randomFallbackPrompt();
      try { await env.MESSAGES_KV.put(cacheKey, prompt, { expirationTtl:7200 }); } catch(_) {}
      return json({ prompt });
    } catch { return json({ prompt: randomFallbackPrompt() }); }
  }

  return json({ error: 'Unknown type.' }, 400);
}

function randomFallbackDare(username) {
  const n = username || 'them';
  const dares = [
    `What's ${n}'s biggest red flag honestly?`,
    `Would you date ${n} if they asked you?`,
    `Rate ${n}'s personality out of 10`,
    `What does ${n} actually need to hear?`,
    `What's one thing ${n} would never admit?`,
    `Is ${n} the villain or the main character?`,
    `What's ${n}'s most unhinged quality?`,
  ];
  return dares[Math.floor(Math.random()*dares.length)];
}

function randomFallbackGame() {
  const games = [
    'NPC test: what would you say to snap me out of it?',
    'Would you rather I ghost or overshare — be honest',
    'Rate my main character energy 1–10',
    'Finish this: the most unhinged thing about me is…',
    'Real talk — am I the villain or the victim?',
    'Vibe check: what era am I in right now?',
    'One word that would break my villain arc',
  ];
  return games[Math.floor(Math.random()*games.length)];
}

function randomFallbackPrompt() {
  const p = [
    "What's one thing you'd never say to my face?",
    "Rate my personality on a scale of 1 to 10",
    "Be honest — what's your first impression of me?",
    "What do people say about me when I'm not around?",
    "Tell me something I don't know about myself",
  ];
  return p[Math.floor(Math.random()*p.length)];
}
