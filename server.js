'use strict';

/* =====================================================================
   जनमत (Janmat) — server v2
   ---------------------------------------------------------------------
   Features
   • Naam-se login (no password for users)
   • 1 user = 2 chunav / din (IST calendar day)
   • 1 device = 1 vote per election  (device fingerprint + server IP fallback)
   • Creator & voter identity sirf developer dekh sakta hai
   • Developer panel password se (default: KHOHDEEG)
   • Results permanent (JSON file ya Upstash Redis — jo available ho)

   Storage:
     • Agar UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN set hain -> Upstash
     • warna local data/db.json
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const PORT = Number(process.env.PORT || 3000);
const DEV_PASSWORD = process.env.DEV_PASSWORD || 'KHOHDEEG';
const DAILY_ELECTION_LIMIT = Math.max(1, Number(process.env.DAILY_ELECTION_LIMIT || 2));
const SESSION_DAYS = 180;
const DEV_SESSION_HOURS = 12;

const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(UPSTASH_URL && UPSTASH_TOKEN);
const REDIS_KEY = process.env.REDIS_KEY || 'janmat:db';

fs.mkdirSync(DATA_DIR, { recursive: true });

/* =====================================================================
   Utils
   ===================================================================== */

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = (n = 16) => crypto.randomBytes(n).toString('hex');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function clean(str, max = 120) {
  return String(str == null ? '' : str)
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/* IST calendar day key — quota is per Indian day */
function istDayKey(ts = Date.now()) {
  const shifted = new Date(Number(ts) + 5.5 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}
function nextIstMidnight(ts = Date.now()) {
  const shifted = new Date(Number(ts) + 5.5 * 3600 * 1000);
  shifted.setUTCHours(24, 0, 0, 0);
  return shifted.getTime() - 5.5 * 3600 * 1000;
}

function nameKey(name) {
  return clean(name, 40).toLowerCase().replace(/\s+/g, ' ');
}

const RESERVED_NAMES = new Set(['developer', 'dev', 'admin', 'administrator', 'janmat', 'moderator', 'root']);

const SYMBOL_IDS = [
  'diya', 'sunflower', 'tractor', 'bicycle', 'wheat', 'bat', 'book', 'star', 'hand', 'house',
  'bell', 'umbrella', 'drum', 'flag', 'bulb', 'tree', 'fish', 'kite', 'leaf', 'clock', 'key',
  'pen', 'mango', 'rose',
];

/* =====================================================================
   Storage layer (file  <->  Upstash Redis)
   ===================================================================== */

let db = null;
let saveTimer = null;
let pendingSave = null;
let storageMode = USE_REDIS ? 'redis' : 'file';

async function redisRequest(pathname, body) {
  const res = await fetch(UPSTASH_URL + pathname, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + UPSTASH_TOKEN,
      'Content-Type': 'text/plain',
    },
    body: body,
  });
  if (!res.ok) throw new Error('Redis HTTP ' + res.status);
  return res.json();
}

async function loadDb() {
  if (USE_REDIS) {
    try {
      const out = await redisRequest('/get/' + encodeURIComponent(REDIS_KEY));
      if (out && typeof out.result === 'string' && out.result) {
        const parsed = JSON.parse(out.result);
        if (parsed && parsed.version === 2) {
          console.log('📦 loaded from Upstash Redis');
          return parsed;
        }
      }
      console.log('📦 Upstash empty — seeding fresh data');
      const fresh = seedDb();
      await persistNow(fresh);
      return fresh;
    } catch (err) {
      console.error('⚠️  Redis load failed, falling back to file:', err.message);
      storageMode = 'file';
    }
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2) return parsed;
    console.log('ℹ️  old data format found — starting fresh (v2)');
  } catch (_) { /* fresh */ }
  const fresh = seedDb();
  writeFileDb(fresh);
  return fresh;
}

function writeFileDb(data) {
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('DB file write failed:', err.message);
  }
}

async function persistNow(data) {
  if (USE_REDIS && storageMode === 'redis') {
    try {
      await redisRequest('/set/' + encodeURIComponent(REDIS_KEY), JSON.stringify(data || db));
      return;
    } catch (err) {
      console.error('Redis save failed:', err.message);
    }
  }
  writeFileDb(data || db);
}

/** debounced save (use for non-critical writes) */
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    pendingSave = null;
    persistNow();
  }, 150);
  if (saveTimer.unref) saveTimer.unref();
}

/** immediate save (votes / signups / elections) */
async function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  pendingSave = null;
  await persistNow();
}

/* =====================================================================
   Seed data (demo users + demo elections, clearly marked)
   ===================================================================== */

const SEED_DEMO = process.env.SEED_DEMO === '1';

function seedDb() {
  const now = Date.now();

  // production me koi demo/fake data nahi — sirf khaali system
  if (!SEED_DEMO) {
    return { version: 2, createdAt: now, users: [], elections: [], devSessions: {} };
  }

  const users = [];
  const mkUser = (name, isDemo, createdAt) => {
    const u = {
      id: rid(8),
      name,
      nameLower: nameKey(name),
      createdAt,
      lastLoginAt: createdAt,
      isDemo: !!isDemo,
      devices: {},
      tokens: {},
    };
    users.push(u);
    return u;
  };
  const mkCand = (name, party, symbol) => ({ id: rid(6), name, party: party || '', symbol });

  const organizer = mkUser('डेमो आयोजक', true, now - 1000 * 60 * 60 * 30);
  const voters = ['रामकिशन', 'सुनीता', 'मोहन', 'सलीम', 'अनीता', 'विकास', 'फरहान', 'गीता', 'हरि', 'मीना']
    .map((n, i) => mkUser(n + ' (डेमो)', true, now - 1000 * 60 * 60 * (28 - i)));

  const e1 = {
    code: 'DEMO01',
    title: 'ग्राम पंचायत सरपंच चुनाव',
    type: 'सरपंच',
    gram: 'नीमगाँव',
    district: 'अलवर',
    state: 'राजस्थान',
    createdAt: now - 1000 * 60 * 60 * 20,
    closed: false,
    closedAt: null,
    creatorId: organizer.id,
    isDemo: true,
    candidates: [
      mkCand('रामकिशन यादव', 'निर्दलीय', 'diya'),
      mkCand('सुनीता देवी', 'महिला मोर्चा', 'sunflower'),
      mkCand('मोहन लाल शर्मा', 'ग्राम विकास पार्टी', 'tractor'),
      mkCand('सलीम खान', 'निर्दलीय', 'bicycle'),
    ],
    votes: {},
    devices: {},
  };
  const e2 = {
    code: 'DEMO02',
    title: 'कॉलोनी कल्याण समिति अध्यक्ष चुनाव',
    type: 'सोसाइटी अध्यक्ष',
    gram: 'शांति नगर कॉलोनी, सेक्टर 14',
    district: 'गुरुग्राम',
    state: 'हरियाणा',
    createdAt: now - 1000 * 60 * 42,
    closed: false,
    closedAt: null,
    creatorId: organizer.id,
    isDemo: true,
    candidates: [
      mkCand('अनीता गुप्ता', 'निर्दलीय', 'house'),
      mkCand('विकास सिंघल', 'प्रगति समूह', 'bulb'),
      mkCand('फरहान अंसारी', 'युवा मंच', 'bat'),
    ],
    votes: {},
    devices: {},
  };

  // demo votes (so the charts & dev panel are not empty)
  const cast = (e, voter, candIdx, minsAgo) => {
    const cand = e.candidates[candIdx];
    if (!cand) return;
    e.votes[voter.id] = { c: cand.id, at: now - minsAgo * 60000, device: 'demo-' + voter.id.slice(0, 6) };
    e.devices['demo-' + voter.id.slice(0, 6)] = { userId: voter.id, at: now - minsAgo * 60000 };
  };
  [[0, 0, 300], [0, 0, 280], [1, 0, 260], [2, 1, 240], [3, 1, 220], [4, 1, 200],
   [5, 2, 180], [6, 2, 160], [7, 3, 140]].forEach(([vi, ci, m]) => cast(e1, voters[vi], ci, m));
  [[0, 0, 120], [1, 0, 100], [2, 1, 80], [3, 1, 60], [4, 2, 40]].forEach(([vi, ci, m]) => cast(e2, voters[vi], ci, m));

  return {
    version: 2,
    createdAt: now,
    users,
    elections: [e1, e2],
    devSessions: {},
  };
}

/* =====================================================================
   Domain helpers
   ===================================================================== */

function newCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[crypto.randomBytes(1)[0] % CODE_ALPHABET.length];
  } while (db.elections.some((e) => e.code === code));
  return code;
}

const findElection = (code) => {
  const c = clean(code, 16).toUpperCase();
  return db.elections.find((e) => e.code === c) || null;
};

const findUserById = (id) => db.users.find((u) => u.id === id) || null;
const findUserByName = (name) => db.users.find((u) => u.nameLower === nameKey(name)) || null;

function userByToken(token) {
  if (!token || !/^[a-f0-9]{16,80}$/.test(String(token))) return null;
  return db.users.find((u) => u.tokens && u.tokens[token]) || null;
}

function tally(e) {
  const counts = {};
  e.candidates.forEach((c) => (counts[c.id] = 0));
  let total = 0;
  for (const v of Object.values(e.votes || {})) {
    if (v && counts[v.c] !== undefined) {
      counts[v.c]++;
      total++;
    }
  }
  const rows = e.candidates.map((c) => ({
    id: c.id,
    name: c.name,
    party: c.party || '',
    symbol: c.symbol || 'diya',
    votes: counts[c.id] || 0,
    percent: total ? Math.round(((counts[c.id] || 0) / total) * 1000) / 10 : 0,
  }));
  rows.sort((a, b) => b.votes - a.votes);
  const top = rows.length ? rows[0].votes : 0;
  const leaders = rows.filter((r) => r.votes === top && top > 0);
  return {
    totalVotes: total,
    candidates: rows,
    winnerIds: e.closed && leaders.length ? leaders.map((l) => l.id) : [],
    tie: e.closed && leaders.length > 1,
  };
}

/** PUBLIC view — creator & voter identities are stripped out */
function publicSummary(e) {
  const t = tally(e);
  return {
    code: e.code,
    title: e.title,
    type: e.type,
    gram: e.gram,
    district: e.district,
    state: e.state,
    createdAt: e.createdAt,
    closed: !!e.closed,
    closedAt: e.closedAt || null,
    demo: !!e.isDemo,
    totalVotes: t.totalVotes,
    candidateCount: e.candidates.length,
    symbols: e.candidates.slice(0, 5).map((c) => c.symbol || 'diya'),
  };
}

function publicElection(e, viewer) {
  const t = tally(e);
  const myVote = viewer && e.votes[viewer.id] ? e.votes[viewer.id].c : null;
  const isCreator = !!(viewer && e.creatorId === viewer.id);
  return {
    ...publicSummary(e),
    candidates: e.candidates.map((c) => ({ id: c.id, name: c.name, party: c.party || '', symbol: c.symbol || 'diya' })),
    results: t,
    hasVoted: !!myVote,
    myVote,
    canManage: isCreator,
  };
}

function quotaFor(user) {
  const today = istDayKey();
  const used = db.elections.filter((e) => e.creatorId === user.id && istDayKey(e.createdAt) === today).length;
  return {
    limit: DAILY_ELECTION_LIMIT,
    used,
    remaining: Math.max(0, DAILY_ELECTION_LIMIT - used),
    resetsAt: nextIstMidnight(),
  };
}

function publicUser(u) {
  return { id: u.id, name: u.name, createdAt: u.createdAt };
}

function deviceKeyFrom(req, bodyDevice) {
  const device = clean(bodyDevice || req.headers['x-device-id'] || '', 80);
  if (device && /^[A-Za-z0-9_-]{8,80}$/.test(device)) return 'd:' + sha256(device).slice(0, 40);
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket.remoteAddress || 'unknown';
  const ua = String(req.headers['user-agent'] || '');
  return 'ip:' + sha256(ip + '|' + ua).slice(0, 40);
}

/* =====================================================================
   Real-time hub (Server-Sent Events) — koi extra library nahi
   ===================================================================== */

const liveClients = new Set();
let liveSeq = 0;

function sseWrite(client, event, data) {
  try {
    client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (_) {
    liveClients.delete(client);
  }
}

/** election update sabhi subscribers ko */
function broadcastElection(code, payload) {
  for (const c of liveClients) {
    if (c.kind !== 'election' || c.code !== code) continue;
    sseWrite(c, 'update', payload);
  }
}

/** developer ko live vote feed */
function broadcastDev(event, payload) {
  for (const c of liveClients) {
    if (c.kind !== 'dev') continue;
    sseWrite(c, event, payload);
  }
}

setInterval(() => {
  for (const c of liveClients) {
    try { c.res.write(': ping\n\n'); } catch (_) { liveClients.delete(c); }
  }
}, 25000).unref();

/* =====================================================================
   HTTP helpers
   ===================================================================== */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const rateBuckets = new Map();
function rateLimit(req, bucket, max, windowMs = 60000) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';
  const key = bucket + ':' + ip;
  const now = Date.now();
  const entry = rateBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
  entry.count++;
  rateBuckets.set(key, entry);
  if (rateBuckets.size > 8000) rateBuckets.clear();
  return entry.count <= max;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function devTokenValid(req) {
  const token = clean(req.headers['x-dev-token'] || '', 80);
  if (!token) return false;
  const s = db.devSessions[token];
  if (!s) return false;
  if (s.expiresAt < Date.now()) {
    delete db.devSessions[token];
    save();
    return false;
  }
  return true;
}

/* =====================================================================
   API
   ===================================================================== */

const TYPES = new Set([
  'सरपंच', 'ग्राम प्रधान', 'मुखिया', 'पंचायत सदस्य', 'पंचायत समिति सदस्य',
  'जिला परिषद सदस्य', 'विधायक (MLA)', 'सांसद (MP)', 'नगर पालिका अध्यक्ष',
  'सोसाइटी अध्यक्ष', 'स्कूल/कॉलेज चुनाव', 'अन्य',
]);

async function handleApi(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method || 'GET';
  const url = new URL(req.url, 'http://localhost');
  const viewer = userByToken(req.headers['x-user-token']);

  /* ---------- health / stats ---------- */
  if (method === 'GET' && parts[1] === 'health') {
    return sendJson(res, 200, {
      ok: true,
      storage: storageMode,
      version: 2,
      seedDemo: SEED_DEMO,
      liveConnections: liveClients.size,
      time: Date.now(),
    });
  }

  if (method === 'GET' && parts[1] === 'stats' && parts.length === 2) {
    let votes = 0;
    db.elections.forEach((e) => (votes += Object.keys(e.votes || {}).length));
    const states = new Set(db.elections.map((e) => e.state).filter(Boolean));
    return sendJson(res, 200, {
      elections: db.elections.length,
      votes,
      states: states.size,
      candidates: db.elections.reduce((a, e) => a + e.candidates.length, 0),
      users: db.users.filter((u) => !u.isDemo).length,
      dailyLimit: DAILY_ELECTION_LIMIT,
    });
  }

  /* ---------- auth (name only) ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'login') {
    if (!rateLimit(req, 'login', 20, 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा लॉगिन कोशिशें। एक मिनट बाद प्रयास करें।' });
    }
    const body = await readBody(req);
    const name = clean(body.name, 30);

    if (!name) return sendJson(res, 400, { error: 'अपना नाम लिखें।' });
    if (name.length < 2) return sendJson(res, 400, { error: 'नाम कम से कम 2 अक्षरों का होना चाहिए।' });
    if (!/^[\p{L}\p{M}\p{N} .'_-]+$/u.test(name)) {
      return sendJson(res, 400, { error: 'नाम में सिर्फ अक्षर, अंक, स्पेस और . \' _ - चलेंगे।' });
    }
    if (RESERVED_NAMES.has(nameKey(name))) {
      return sendJson(res, 400, { error: 'यह नाम आरक्षित है, कृपया दूसरा नाम चुनें।' });
    }

    let user = findUserByName(name);
    if (!user) {
      user = {
        id: rid(8),
        name,
        nameLower: nameKey(name),
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
        isDemo: false,
        devices: {},
        tokens: {},
      };
      db.users.push(user);
    } else {
      user.lastLoginAt = Date.now();
      if (name !== user.name) user.name = name; // preserve latest capitalisation
    }

    const device = deviceKeyFrom(req, body.deviceId);
    user.devices[device] = Date.now();
    if (Object.keys(user.devices).length > 40) {
      const entries = Object.entries(user.devices).sort((a, b) => b[1] - a[1]).slice(0, 40);
      user.devices = Object.fromEntries(entries);
    }

    const token = rid(24);
    user.tokens[token] = Date.now();
    const tokens = Object.entries(user.tokens).sort((a, b) => b[1] - a[1]).slice(0, 12);
    user.tokens = Object.fromEntries(tokens);

    await saveNow();
    return sendJson(res, 200, { user: publicUser(user), token, quota: quotaFor(user) });
  }

  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'logout') {
    const token = clean(req.headers['x-user-token'] || '', 80);
    if (viewer && token && viewer.tokens[token]) {
      delete viewer.tokens[token];
      await saveNow();
    }
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && parts[1] === 'auth' && parts[2] === 'me') {
    if (!viewer) return sendJson(res, 401, { error: 'लॉगिन नहीं है।', code: 'LOGIN_REQUIRED' });
    const myVotes = db.elections.filter((e) => e.votes[viewer.id]).length;
    return sendJson(res, 200, {
      user: publicUser(viewer),
      quota: quotaFor(viewer),
      counts: { elections: db.elections.filter((e) => e.creatorId === viewer.id).length, votes: myVotes },
    });
  }

  /* ---------- elections: list ---------- */
  if (method === 'GET' && parts[1] === 'elections' && parts.length === 2) {
    const search = clean(url.searchParams.get('q') || '', 80).toLowerCase();
    const state = clean(url.searchParams.get('state') || '', 60).toLowerCase();
    let list = [...db.elections].sort((a, b) => b.createdAt - a.createdAt);
    if (state) list = list.filter((e) => String(e.state).toLowerCase() === state);
    if (search) {
      list = list.filter((e) =>
        [e.title, e.gram, e.district, e.state, e.type, e.code].join(' ').toLowerCase().includes(search)
      );
    }
    const states = [...new Set(db.elections.map((e) => e.state).filter(Boolean))].sort();
    return sendJson(res, 200, { elections: list.slice(0, 300).map(publicSummary), states });
  }

  /* ---------- elections: create ---------- */
  if (method === 'POST' && parts[1] === 'elections' && parts.length === 2) {
    if (!viewer) {
      return sendJson(res, 401, { error: 'चुनाव बनाने के लिए पहले नाम से लॉगिन करें।', code: 'LOGIN_REQUIRED' });
    }
    if (!rateLimit(req, 'create', 12, 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा अनुरोध। एक मिनट बाद प्रयास करें।' });
    }
    const q = quotaFor(viewer);
    if (q.remaining <= 0) {
      return sendJson(res, 403, {
        error: `आप आज की सीमा (${q.limit} चुनाव प्रतिदिन) पूरी कर चुके हैं। अगला चुनाव ${new Date(q.resetsAt).toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata' })} के बाद बना सकते हैं।`,
        code: 'DAILY_LIMIT',
        quota: q,
      });
    }

    const body = await readBody(req);
    const type = clean(body.type, 40) || 'अन्य';
    const gram = clean(body.gram, 90);
    const district = clean(body.district, 60);
    const state = clean(body.state, 60);
    let title = clean(body.title, 110);

    if (!gram) return sendJson(res, 400, { error: 'गाँव / क्षेत्र का नाम ज़रूरी है।' });
    if (!district) return sendJson(res, 400, { error: 'ज़िला ज़रूरी है।' });
    if (!state) return sendJson(res, 400, { error: 'राज्य ज़रूरी है।' });

    const rawCandidates = Array.isArray(body.candidates) ? body.candidates : [];
    const candidates = [];
    for (const c of rawCandidates) {
      const name = clean(c && c.name, 60);
      if (!name) continue;
      let symbol = clean(c && c.symbol, 24);
      if (!SYMBOL_IDS.includes(symbol)) symbol = SYMBOL_IDS[candidates.length % SYMBOL_IDS.length];
      candidates.push({ id: rid(6), name, party: clean(c && c.party, 50), symbol });
      if (candidates.length >= 40) break;
    }
    if (candidates.length < 2) {
      return sendJson(res, 400, { error: 'कम से कम 2 उम्मीदवारों के नाम डालें।' });
    }
    const seen = new Set();
    for (const c of candidates) {
      const k = c.name.toLowerCase();
      if (seen.has(k)) return sendJson(res, 400, { error: 'एक ही नाम के दो उम्मीदवार नहीं हो सकते: ' + c.name });
      seen.add(k);
    }
    if (!title) title = `${gram} — ${type} चुनाव`;

    const e = {
      code: newCode(),
      title,
      type,
      gram,
      district,
      state,
      createdAt: Date.now(),
      closed: false,
      closedAt: null,
      creatorId: viewer.id,
      isDemo: false,
      candidates,
      votes: {},
      devices: {},
    };
    db.elections.push(e);
    await saveNow();
    broadcastDev('new-election', {
      at: e.createdAt,
      code: e.code,
      title: e.title,
      gram: e.gram,
      district: e.district,
      state: e.state,
      creatorName: viewer.name,
    });
    return sendJson(res, 201, {
      election: publicElection(e, viewer),
      quota: quotaFor(viewer),
    });
  }

  const code = parts[2];
  const election = parts[1] === 'elections' && code ? findElection(code) : null;

  /* ---------- election: single ---------- */
  if (method === 'GET' && election && parts.length === 3) {
    return sendJson(res, 200, publicElection(election, viewer));
  }

  /* ---------- election: vote ---------- */
  if (method === 'POST' && election && parts[3] === 'vote') {
    if (!viewer) {
      return sendJson(res, 401, { error: 'वोट देने के लिए पहले अपना नाम लिखकर लॉगिन करें।', code: 'LOGIN_REQUIRED' });
    }
    if (election.closed) {
      return sendJson(res, 403, { error: 'यह चुनाव समाप्त हो चुका है, अब वोट नहीं डाला जा सकता।' });
    }
    if (!rateLimit(req, 'vote', 40, 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा अनुरोध। थोड़ी देर बाद प्रयास करें।' });
    }
    const body = await readBody(req);
    const candidateId = clean(body.candidateId, 40);
    const device = deviceKeyFrom(req, body.deviceId);

    const cand = election.candidates.find((c) => c.id === candidateId);
    if (!cand) return sendJson(res, 400, { error: 'उम्मीदवार नहीं मिला।' });

    if (election.votes[viewer.id]) {
      return sendJson(res, 409, {
        error: 'आप इस चुनाव में पहले ही वोट कर चुके हैं।',
        code: 'ALREADY_VOTED',
        election: publicElection(election, viewer),
      });
    }
    const dev = election.devices[device];
    if (dev) {
      const other = findUserById(dev.userId);
      const samePerson = other && other.id === viewer.id;
      return sendJson(res, 409, {
        error: samePerson
          ? 'इस चुनाव में आपका वोट पहले ही दर्ज है।'
          : 'इस फ़ोन/डिवाइस से इस चुनाव में वोट दिया जा चुका है। एक डिवाइस से सिर्फ़ एक ही वोट मान्य है।',
        code: 'DEVICE_VOTED',
        election: publicElection(election, viewer),
      });
    }

    election.votes[viewer.id] = { c: cand.id, at: Date.now(), device };
    election.devices[device] = { userId: viewer.id, at: Date.now() };
    await saveNow();

    // 🔴 real-time: election subscribers ko naya tally + developer ko live vote
    const fresh = publicElection(election, null);
    broadcastElection(election.code, { election: fresh });
    broadcastDev('vote', {
      at: election.votes[viewer.id].at,
      userName: viewer.name,
      userId: viewer.id,
      electionCode: election.code,
      electionTitle: election.title,
      candidateName: cand.name,
      candidateSymbol: cand.symbol || 'diya',
      candidateParty: cand.party || '',
      totalVotes: fresh.totalVotes,
    });

    return sendJson(res, 200, {
      ok: true,
      votedFor: { id: cand.id, name: cand.name, symbol: cand.symbol },
      election: publicElection(election, viewer),
    });
  }

  /* ---------- election: close / reopen (creator or developer) ---------- */
  if (method === 'POST' && election && (parts[3] === 'close' || parts[3] === 'reopen')) {
    const isCreator = !!viewer && election.creatorId === viewer.id;
    const isDev = devTokenValid(req);
    if (!isCreator && !isDev) {
      return sendJson(res, 403, { error: 'सिर्फ़ चुनाव बनाने वाला (या डेवलपर) इसे बंद कर सकता है।' });
    }
    election.closed = parts[3] === 'close';
    election.closedAt = election.closed ? Date.now() : null;
    await saveNow();
    const payload = publicElection(election, null);
    broadcastElection(election.code, { election: payload });
    broadcastDev('election-status', { code: election.code, closed: election.closed, at: Date.now() });
    return sendJson(res, 200, publicElection(election, viewer));
  }

  /* ---------- my area ---------- */
  if (method === 'GET' && parts[1] === 'me' && parts[2] === 'overview') {
    if (!viewer) return sendJson(res, 401, { error: 'लॉगिन नहीं है।', code: 'LOGIN_REQUIRED' });
    const myElections = db.elections
      .filter((e) => e.creatorId === viewer.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({ ...publicSummary(e), leading: tally(e).candidates[0] || null, canManage: true }));
    const myVotes = db.elections
      .filter((e) => e.votes[viewer.id])
      .sort((a, b) => b.votes[viewer.id].at - a.votes[viewer.id].at)
      .map((e) => {
        const v = e.votes[viewer.id];
        const cand = e.candidates.find((c) => c.id === v.c);
        return {
          code: e.code,
          title: e.title,
          gram: e.gram,
          district: e.district,
          state: e.state,
          at: v.at,
          closed: !!e.closed,
          candidate: cand ? { name: cand.name, symbol: cand.symbol || 'diya', party: cand.party || '' } : null,
        };
      });
    return sendJson(res, 200, {
      user: publicUser(viewer),
      quota: quotaFor(viewer),
      elections: myElections,
      votes: myVotes,
    });
  }

  /* ---------- account: delete (privacy) ---------- */
  if (method === 'POST' && parts[1] === 'account' && parts[2] === 'delete') {
    if (!viewer) return sendJson(res, 401, { error: 'लॉगिन नहीं है।', code: 'LOGIN_REQUIRED' });
    const body = await readBody(req);
    if (body.confirm !== true) return sendJson(res, 400, { error: 'पुष्टि ज़रूरी है।' });

    // votes aur chunav rehte hain (results ki sacchai ke liye), par pehchan hata di jaati hai
    viewer.deletedAt = Date.now();
    viewer.name = 'हटाया गया उपयोगकर्ता';
    viewer.nameLower = 'deleted:' + viewer.id;
    viewer.tokens = {};
    viewer.devices = {};
    viewer.lastLoginAt = Date.now();

    await saveNow();
    broadcastDev('user-deleted', { userId: viewer.id, at: Date.now() });
    return sendJson(res, 200, { ok: true, message: 'आपका खाता हटा दिया गया। आपके वोटों की गिनती बरकरार रहेगी (बिना नाम के)।' });
  }

  /* ================= developer API ================= */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'login') {
    if (!rateLimit(req, 'devlogin', 8, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा प्रयास। 10 मिनट बाद कोशिश करें।' });
    }
    const body = await readBody(req);
    const pass = String(body.password == null ? '' : body.password);
    if (!safeEqual(pass, DEV_PASSWORD)) {
      return sendJson(res, 401, { error: 'गलत पासवर्ड।' });
    }
    const token = rid(28);
    db.devSessions[token] = { createdAt: Date.now(), expiresAt: Date.now() + DEV_SESSION_HOURS * 3600 * 1000 };
    // prune old sessions
    const nowTs = Date.now();
    Object.entries(db.devSessions).forEach(([k, v]) => { if (!v || v.expiresAt < nowTs) delete db.devSessions[k]; });
    await saveNow();
    return sendJson(res, 200, {
      devToken: token,
      expiresAt: db.devSessions[token].expiresAt,
      storage: storageMode,
    });
  }

  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'logout') {
    const token = clean(req.headers['x-dev-token'] || '', 80);
    if (db.devSessions[token]) {
      delete db.devSessions[token];
      await saveNow();
    }
    return sendJson(res, 200, { ok: true });
  }

  /* ---------- live stream: election (public, anonymised) ---------- */
  if (method === 'GET' && parts[1] === 'stream') {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';
    const mine = [...liveClients].filter((c) => c.ip === ip).length;
    if (mine >= 6) return sendJson(res, 429, { error: 'बहुत ज़्यादा लाइव कनेक्शन।' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');

    const code = clean(url.searchParams.get('election') || '', 16).toUpperCase();
    const client = { id: ++liveSeq, res, ip, kind: 'election', code };
    liveClients.add(client);

    if (code) {
      const e = findElection(code);
      if (e) sseWrite(client, 'update', { election: publicElection(e, viewer) });
    }
    sseWrite(client, 'hello', { ok: true, election: code || null, time: Date.now() });

    req.on('close', () => { liveClients.delete(client); try { res.end(); } catch (_) {} });
    return;
  }

  /* ---------- live stream: developer (needs dev token) ---------- */
  if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'stream') {
    const t = clean(url.searchParams.get('token') || req.headers['x-dev-token'] || '', 80);
    const sess = db.devSessions[t];
    if (!sess || sess.expiresAt < Date.now()) {
      return sendJson(res, 401, { error: 'डेवलपर लॉगिन ज़रूरी है।', code: 'DEV_LOGIN_REQUIRED' });
    }
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'x';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 4000\n\n');
    const client = { id: ++liveSeq, res, ip, kind: 'dev', code: null };
    liveClients.add(client);
    sseWrite(client, 'hello', { ok: true, time: Date.now() });
    req.on('close', () => { liveClients.delete(client); try { res.end(); } catch (_) {} });
    return;
  }

  if (parts[1] === 'dev' && !devTokenValid(req)) {
    return sendJson(res, 401, { error: 'डेवलपर लॉगिन ज़रूरी है।', code: 'DEV_LOGIN_REQUIRED' });
  }

  if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'overview') {
    const users = db.users
      .map((u) => {
        const created = db.elections.filter((e) => e.creatorId === u.id);
        const voted = db.elections.filter((e) => e.votes[u.id]);
        return {
          id: u.id,
          name: u.name,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt || null,
          isDemo: !!u.isDemo,
          electionsCreated: created.length,
          votesCast: voted.length,
          deviceCount: Object.keys(u.devices || {}).length,
          electionCodes: created.map((e) => e.code),
        };
      })
      .sort((a, b) => (b.lastLoginAt || 0) - (a.lastLoginAt || 0));

    const elections = [...db.elections]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => {
        const t = tally(e);
        const creator = findUserById(e.creatorId);
        return {
          code: e.code,
          title: e.title,
          type: e.type,
          gram: e.gram,
          district: e.district,
          state: e.state,
          createdAt: e.createdAt,
          closed: !!e.closed,
          closedAt: e.closedAt || null,
          isDemo: !!e.isDemo,
          creatorId: e.creatorId,
          creatorName: creator ? creator.name : 'अज्ञात',
          creatorIsDemo: creator ? !!creator.isDemo : false,
          totalVotes: t.totalVotes,
          candidateCount: e.candidates.length,
          deviceCount: Object.keys(e.devices || {}).length,
          leading: t.candidates[0] || null,
          winner: e.closed ? (t.candidates[0] || null) : null,
        };
      });

    const voteRows = [];
    db.elections.forEach((e) => {
      Object.entries(e.votes || {}).forEach(([uid, v]) => {
        const u = findUserById(uid);
        const cand = e.candidates.find((c) => c.id === (v && v.c));
        voteRows.push({
          at: (v && v.at) || 0,
          userId: uid,
          userName: u ? u.name : 'अज्ञात उपयोगकर्ता',
          userIsDemo: u ? !!u.isDemo : true,
          electionCode: e.code,
          electionTitle: e.title,
          electionDemo: !!e.isDemo,
          candidateId: cand ? cand.id : null,
          candidateName: cand ? cand.name : '—',
          candidateSymbol: cand ? cand.symbol || 'diya' : 'diya',
          candidateParty: cand ? cand.party || '' : '',
          deviceShort: v && v.device ? String(v.device).slice(0, 10) : '',
        });
      });
    });
    voteRows.sort((a, b) => b.at - a.at);

    const today = istDayKey();
    const stats = {
      users: db.users.filter((u) => !u.isDemo).length,
      demoUsers: db.users.filter((u) => u.isDemo).length,
      elections: db.elections.length,
      votes: voteRows.length,
      todayElections: db.elections.filter((e) => istDayKey(e.createdAt) === today).length,
      todayVotes: voteRows.filter((v) => istDayKey(v.at) === today).length,
      storage: storageMode,
      dailyLimit: DAILY_ELECTION_LIMIT,
      serverTime: Date.now(),
    };

    return sendJson(res, 200, { stats, users, elections, votes: voteRows.slice(0, 1000) });
  }

  /* developer: single election drill-down with who-voted-for-whom */
  if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'elections' && parts[3]) {
    const e = findElection(parts[3]);
    if (!e) return sendJson(res, 404, { error: 'चुनाव नहीं मिला।' });
    const creator = findUserById(e.creatorId);
    const votes = Object.entries(e.votes || {})
      .map(([uid, v]) => {
        const u = findUserById(uid);
        const cand = e.candidates.find((c) => c.id === (v && v.c));
        return {
          at: (v && v.at) || 0,
          userName: u ? u.name : 'अज्ञात',
          userIsDemo: u ? !!u.isDemo : true,
          candidateName: cand ? cand.name : '—',
          candidateSymbol: cand ? cand.symbol || 'diya' : 'diya',
          deviceShort: v && v.device ? String(v.device).slice(0, 10) : '',
        };
      })
      .sort((a, b) => b.at - a.at);
    return sendJson(res, 200, {
      election: {
        ...publicElection(e, null),
        creatorName: creator ? creator.name : 'अज्ञात',
        creatorId: e.creatorId,
      },
      votes,
    });
  }

  /* developer: clear only the seeded demo data */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'demo' && parts[3] === 'purge') {
    db.elections = db.elections.filter((e) => !e.isDemo);
    db.users = db.users.filter((u) => !u.isDemo);
    await saveNow();
    return sendJson(res, 200, { ok: true });
  }

  /* developer: delete an election permanently */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'elections' && parts[4] === 'delete') {
    const idx = db.elections.findIndex((e) => e.code === clean(parts[3], 16).toUpperCase());
    if (idx === -1) return sendJson(res, 404, { error: 'चुनाव नहीं मिला।' });
    db.elections.splice(idx, 1);
    await saveNow();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'API नहीं मिली।' });
}

/* =====================================================================
   Static files
   ===================================================================== */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600',
    });
    res.end(data);
  });
}

/* =====================================================================
   Server bootstrap
   ===================================================================== */

/* CORS — agar frontend kisi doosre domain par ho (jaise GitHub Pages:
   https://a2zmatdaan.github.io) aur API yahan (Render) chal rahi ho, to
   browser ko cross-origin requests ki permission chahiye.
   ALLOWED_ORIGINS env se limit kar sakte hain (comma-separated), warna '*'. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  const allowAll = ALLOWED_ORIGINS.includes('*');
  const ok = allowAll || ALLOWED_ORIGINS.includes(origin);
  if (!ok) return;
  res.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-user-token, x-dev-token, x-device-id'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  if (!allowAll) res.setHeader('Vary', 'Origin');
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  applyCors(req, res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (urlObj.pathname.startsWith('/api/')) {
    handleApi(req, res, urlObj.pathname).catch((err) => {
      console.error('API error:', err.message);
      if (res.headersSent) return res.end();
      sendJson(res, 500, { error: 'सर्वर में कुछ गड़बड़ हुई। फिर कोशिश करें।' });
    });
    return;
  }
  serveStatic(req, res, urlObj.pathname);
});

(async () => {
  db = await loadDb();
  if (!db || db.version !== 2) {
    db = seedDb();
    await persistNow(db);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log('──────────────────────────────────────────────');
    console.log('🗳️  जनमत (Janmat) server v2');
    console.log(`   URL      : http://0.0.0.0:${PORT}`);
    console.log(`   Storage  : ${storageMode === 'redis' ? 'Upstash Redis (permanent)' : 'local file data/db.json'}`);
    console.log(`   Elections: ${db.elections.length} | Users: ${db.users.length}`);
    console.log(`   Daily election limit per user: ${DAILY_ELECTION_LIMIT}`);
    console.log('──────────────────────────────────────────────');
  });
})();

process.on('SIGINT', async () => { try { await persistNow(); } catch (_) {} process.exit(0); });
process.on('SIGTERM', async () => { try { await persistNow(); } catch (_) {} process.exit(0); });
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.message));
