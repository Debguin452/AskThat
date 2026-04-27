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

  // ── AI game — relatable, trend-aware challenge ─────────────────────────
  if (type === 'game') {
    const loc = (url.searchParams.get('loc') || '').slice(0, 80);
    const cacheKey = `groq_game:${username}`;
    try { const c = await env.MESSAGES_KV.get(cacheKey); if (c) return json({ game: c }); } catch(_) {}
    if (!env.GROQ_API_KEY) return json({ game: randomFallbackGame() });
    try {
      const locHint = loc ? `The user's timezone/location context: ${loc}.` : '';
      const raw = await groq(env, [{
        role:'system',
        content:`You write a single short, punchy, relatable anonymous game or challenge for a social app — something people share on Instagram/WhatsApp Stories. 
It should feel current, viral, and fun — like a NPC test, a "would you rather", a vibe check, or a hot take game. 
Reference current trends, Gen Z slang, or relatable situations if relevant.
Max 12 words. No quotes. Just the game/challenge text as a question or prompt.
${locHint}`
      },{ role:'user', content:`Game for "${username}". Make it specific, fresh, shareable.` }], 50);
      const game = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,90) || randomFallbackGame();
      try { await env.MESSAGES_KV.put(cacheKey, game, { expirationTtl: 14400 }); } catch(_) {}
      return json({ game });
    } catch { return json({ game: randomFallbackGame() }); }
  }


    const cacheKey = `groq_prompt:${username}`;
    try { const c = await env.MESSAGES_KV.get(cacheKey); if (c) return json({ prompt: c }); } catch(_) {}
    if (!env.GROQ_API_KEY) return json({ prompt: randomFallbackPrompt() });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:'You write a single fun, interactive, anonymous question that someone poses to their followers. Short (max 10 words). Punchy. Original. No emojis. No quotes. Just the question text.'
      },{ role:'user', content:`Question for someone named "${username}" — make it specific to their name if possible, casual, fun.` }], 40);
      const prompt = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,80) || randomFallbackPrompt();
      try { await env.MESSAGES_KV.put(cacheKey, prompt, { expirationTtl:7200 }); } catch(_) {}
      return json({ prompt });
    } catch { return json({ prompt: randomFallbackPrompt() }); }
  

  return json({ error: 'Unknown type.' }, 400);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error:'Invalid JSON.'}, 400); }

  // ── Mood detection ─────────────────────────────────────────────────────
  if (body.type === 'mood') {
    const text = (body.text||'').trim().slice(0,500);
    if (!text) return json({ mood:'neutral' });
    if (!env.GROQ_API_KEY) return json({ mood: clientMood(text) });
    try {
      const raw = await groq(env,[{
        role:'system', content:'Classify the emotional tone. Reply with ONE word only from: wholesome, funny, spicy, deep, sad, supportive, flirty, weird'
      },{ role:'user', content:text }], 5);
      const VALID = ['wholesome','funny','spicy','deep','sad','supportive','flirty','weird'];
      return json({ mood: VALID.includes(raw.toLowerCase()) ? raw.toLowerCase() : clientMood(text) });
    } catch { return json({ mood: clientMood(text) }); }
  }

  return json({ error:'Unknown type.'}, 400);
}

function clientMood(t) {
  t = t.toLowerCase();
  if (/love|appreciate|amazing|best|kind|sweet|heart|grateful/.test(t)) return 'wholesome';
  if (/lol|haha|funny|hilarious|joke|lmao|bruh|😂|💀/.test(t))         return 'funny';
  if (/hot|crush|like you|pretty|attractive|date/.test(t))              return 'flirty';
  if (/why|think|wonder|feel|believe|mind|actually|real talk/.test(t))  return 'deep';
  if (/miss|sad|alone|wish|hurt|sorry|cry/.test(t))                    return 'sad';
  if (/you got|keep going|proud|believe in|support/.test(t))           return 'supportive';
  if (/what the|random|weird|unexpected/.test(t))                      return 'weird';
  return 'spicy';
}

function defaultPlaceholders() {
  return [
    "Something I've always wanted to tell you...",
    "Honestly? You should know this about yourself.",
    "The thing I notice most about you is...",
    "This is something I'd never say to your face.",
    "One word I'd use to describe you is...",
  ];
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
