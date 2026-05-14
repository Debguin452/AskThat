const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL    = 'llama-3.1-8b-instant';

const TTL = {
  PLACEHOLDERS: 172800, // 2 days
  PROMPT:        86400, // 1 day
  DARE:          43200, // 12 hours
};

// Single merged cache key — all AI content per user in one key
function cacheKey(username) { return `groq_ai:${username}`; }

const BAD_WORDS = /\b(fuck|shit|bitch|cunt|nigger|nigga|faggot|retard|kill\s*your?self|kys|suicide|rape|molest|pedophile|nazi|slut|whore|bastard|asshole|dickhead|motherfucker)\b/i;

function json(data, s=200) {
  return new Response(JSON.stringify(data), { status:s, headers:{'Content-Type':'application/json','Cache-Control':'no-store'} });
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

async function getCache(env, username) {
  try {
    const raw = await env.MESSAGES_KV.get(cacheKey(username));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function setCache(env, username, data) {
  try {
    await env.MESSAGES_KV.put(cacheKey(username), JSON.stringify(data), { expirationTtl: TTL.PLACEHOLDERS });
  } catch(_) {}
}

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url);
  const type     = url.searchParams.get('type');
  const username = (url.searchParams.get('username') || 'them').trim().toLowerCase().slice(0,30);

  if (!type) return json({ error:'Missing type.' }, 400);

  // Load shared cache for this user
  const cache = await getCache(env, username);
  let cacheUpdated = false;

  if (type === 'placeholders') {
    if (cache.placeholders) return json({ placeholders: cache.placeholders });
    if (!env.GROQ_API_KEY)  return json({ placeholders: defaultPlaceholders() });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:'Generate 5 short, varied, anonymous message prompts for an anonymous Q&A app. Return ONLY a JSON array of 5 strings, each under 80 chars. Tones: curious, playful, honest, deep, funny. No bad words.'
      },{ role:'user', content:`For a person named "${username}". JSON array only.` }], 250);
      let ph;
      try { ph=JSON.parse(raw.replace(/```json|```/g,'').trim()); if(!Array.isArray(ph)||ph.length<3)throw 0; ph=ph.slice(0,5).map(p=>String(p).slice(0,100)).filter(p=>!BAD_WORDS.test(p)); }
      catch { ph=defaultPlaceholders(); }
      cache.placeholders = ph; cacheUpdated = true;
      if (cacheUpdated) await setCache(env, username, cache);
      return json({ placeholders: ph });
    } catch { return json({ placeholders: defaultPlaceholders() }); }
  }

  if (type === 'dare') {
    if (cache.dare) return json({ dare: cache.dare });
    if (!env.GROQ_API_KEY) return json({ dare: randomFallbackDare(username) });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:`Write a single spicy, honest truth-challenge question that visitors answer ABOUT a person named "${username}" — like a dare game where friends reveal their honest thoughts anonymously. The question is answered BY the visitor about the owner. Max 14 words. No quotes. No bad words. No violent or sexual content.`
      },{ role:'user', content:`Truth challenge for "${username}". Visitors will answer this about them.` }], 60);
      const dare = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,120);
      if (BAD_WORDS.test(dare)) return json({ dare: randomFallbackDare(username) });
      cache.dare = dare; cacheUpdated = true;
      if (cacheUpdated) await setCache(env, username, cache);
      return json({ dare });
    } catch { return json({ dare: randomFallbackDare(username) }); }
  }

  if (type === 'yesno') {
    if (cache.yesno) return json({ question: cache.yesno });
    if (!env.GROQ_API_KEY) return json({ question: randomFallbackYesNo(username) });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:`Write a single yes/no question about a person named "${username}" that their followers will answer anonymously. Should be interesting, slightly controversial but not offensive. Max 12 words. No bad words.`
      },{ role:'user', content:`Yes/no question about "${username}".` }], 50);
      const q = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,100);
      if (BAD_WORDS.test(q)) return json({ question: randomFallbackYesNo(username) });
      cache.yesno = q; cacheUpdated = true;
      if (cacheUpdated) await setCache(env, username, cache);
      return json({ question: q });
    } catch { return json({ question: randomFallbackYesNo(username) }); }
  }

  if (type === 'prompt') {
    if (cache.prompt) return json({ prompt: cache.prompt });
    if (!env.GROQ_API_KEY) return json({ prompt: randomFallbackPrompt() });
    try {
      const raw = await groq(env, [{
        role:'system',
        content:'Write a single fun, anonymous question someone poses to their followers. Max 10 words. Punchy. No bad words. No quotes.'
      },{ role:'user', content:`Question for "${username}".` }], 40);
      const prompt = raw.replace(/^"|"$/g,'').replace(/\n/g,' ').trim().slice(0,80);
      if (BAD_WORDS.test(prompt)) return json({ prompt: randomFallbackPrompt() });
      cache.prompt = prompt; cacheUpdated = true;
      if (cacheUpdated) await setCache(env, username, cache);
      return json({ prompt });
    } catch { return json({ prompt: randomFallbackPrompt() }); }
  }

  return json({ error: 'Unknown type.' }, 400);
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error:'Invalid JSON.'}, 400); }

  if (body.type === 'mood') {
    const text = (body.text||'').trim().slice(0,500);
    if (!text) return json({ mood:'neutral' });
    if (BAD_WORDS.test(text)) return json({ mood:'spicy' });
    if (!env.GROQ_API_KEY) return json({ mood: clientMood(text) });
    try {
      const raw = await groq(env,[{
        role:'system', content:'Classify emotional tone. ONE word only from: wholesome, funny, spicy, deep, sad, supportive, flirty, weird'
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
  if (/lol|haha|funny|hilarious|joke|lmao|bruh/.test(t))               return 'funny';
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

function randomFallbackDare(n) {
  const dares = [
    `What's ${n}'s biggest red flag honestly?`,
    `Would you date ${n} if they asked?`,
    `Rate ${n}'s vibe out of 10`,
    `What does ${n} actually need to hear?`,
    `Is ${n} the villain or the main character?`,
    `What's ${n}'s most underrated quality?`,
    `What would ${n} never admit about themselves?`,
  ];
  return dares[Math.floor(Math.random()*dares.length)];
}

function randomFallbackYesNo(n) {
  const q = [
    `Would you be friends with ${n} in real life?`,
    `Is ${n} the most loyal person you know?`,
    `Would you trust ${n} with a secret?`,
    `Could ${n} survive without social media for a month?`,
    `Would you recommend ${n} to your best friend?`,
  ];
  return q[Math.floor(Math.random()*q.length)];
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
