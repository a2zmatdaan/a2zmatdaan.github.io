'use strict';

/* =====================================================================
   जनमत (Janmat) — server v2
   ---------------------------------------------------------------------
   Features
   • Naam-se login (no password for users)
   • 1 user = 2 chunav / din (IST calendar day)
   • 1 device = 1 vote per election  (device fingerprint + server IP fallback)
   • Creator & voter identity sirf developer dekh sakta hai
   • Developer panel password se (Render → Environment → DEV_PASSWORD)
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
/* कोड में कोई default पासवर्ड नहीं — सिर्फ़ Render के Environment से।
   खाली हो तो डेवलपर पैनल पूरी तरह बंद रहता है (सुरक्षित डिफ़ॉल्ट)। */
const DEV_PASSWORD = String(process.env.DEV_PASSWORD || '');
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
    return { version: 2, createdAt: now, users: [], elections: [], devSessions: {}, deviceOwner: {}, fpOwner: {} };
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

/* =====================================================================
   चुनाव की अवधि (timer) — निर्माता समय तय करता है
   ---------------------------------------------------------------------
   • चुनाव तय समय से पहले न बंद हो सकता, न हटाया जा सकता
   • समय पूरा होते ही अपने आप बंद (auto-close) — कोई background job नहीं चाहिए
   ===================================================================== */
const MIN_DURATION_MIN = 1;              // कम से कम 1 मिनट
const MAX_DURATION_MIN = 30 * 24 * 60;   // ज़्यादा से ज़्यादा 30 दिन
const DEFAULT_DURATION_MIN = 24 * 60;    // डिफ़ॉल्ट 24 घंटे

function normalizeDuration(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DURATION_MIN;
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(n)));
}

/** समय पूरा हुआ? */
function isTimeUp(e, now = Date.now()) {
  return !!(e.endsAt && now >= e.endsAt);
}

/** लेज़ी auto-close — जब भी चुनाव पढ़ा जाए, समय देख लो */
function syncElection(e, now = Date.now()) {
  if (!e.closed && isTimeUp(e, now)) {
    e.closed = true;
    e.closedAt = e.endsAt;
    e.autoClosed = true;
    save();
  }
  return e;
}

/** 🔒 लॉक सिर्फ़ उन चुनावों पर जिनका टाइमर सेट है और समय बाकी है */
function isLocked(e, now = Date.now()) {
  return !!(e && !e.closed && e.endsAt && now < e.endsAt);
}

/** निर्माता समय से पहले कुछ नहीं बदल सकता */
function remainingMs(e, now = Date.now()) {
  if (!e || !e.endsAt) return 0;
  return Math.max(0, e.endsAt - now);
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
    /* ---- timer ---- */
    endsAt: e.endsAt || null,
    durationMin: e.durationMin || null,
    autoClosed: !!e.autoClosed,
    remainingMs: remainingMs(e),
    timeUp: isTimeUp(e),
  };
}

const APP_VERSION = '7.0-guest-vote';

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
    /* निर्माता समय से पहले बंद/डिलीट नहीं कर सकता; समय खत्म होने पर दोनों खुल जाते हैं */
    canCloseNow: isCreator && !e.closed && !e.endsAt,
    canDelete: isCreator && (!!e.closed || !e.endsAt || isTimeUp(e)),
    lockReason: isCreator && isLocked(e)
      ? 'चुनाव तय समय तक चलेगा — ' + Math.ceil(remainingMs(e) / 60000) + ' मिनट बाकी हैं, इससे पहले न बंद कर सकते हैं, न हटा सकते हैं।'
      : null,
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

/* 🟢 बिना लॉगिन वोट (मेहमान मतदाता) — शेयर किया लिंक खोलने वाले को
   लॉगिन करने की ज़रूरत नहीं। पहचान डिवाइस से बनती है, इसलिए नाम के बिना भी
   "एक डिवाइस = एक वोट" का नियम लागू रहता है। */
function guestVoterId(req, bodyDevice) {
  return 'g:' + deviceKeyFrom(req, bodyDevice);
}

/* 🧬 फ़ोन की पहचान (fingerprint) — ब्राउज़र डेटा मिटाने/इनकॉग्निटो के बाद भी
   वही फ़ोन पहचाना जा सके। यह सिर्फ़ "पहचानने" के लिए है, वोट रोकने के लिए
   नहीं (एक ही मॉडल के दो असली फ़ोन का फिंगरप्रिंट एक जैसा निकल सकता है)। */
function fpKeyFrom(req) {
  const raw = clean(req.headers['x-fp'] || '', 200);
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(raw)) return null;
  return 'f:' + sha256(raw).slice(0, 40);
}

/* 🟢 बिना लॉगिन किया गया वोट, बाद में उसी फ़ोन से लॉगिन करने पर
   उस व्यक्ति के नाम से जुड़ जाता है ("मेहमान मतदाता" नहीं रहता)।
   वोट की गिनती वैसी ही रहती है — सिर्फ़ पहचान जुड़ती है। */
function adoptGuestVotes(user, device) {
  const key = 'g:' + device;
  let adopted = 0;
  for (const e of db.elections) {
    const gv = e.votes && e.votes[key];
    if (!gv) continue;
    if (e.votes[user.id]) {
      /* इस व्यक्ति का वोट पहले से है — दोनों वोट रहेंगे, पर नाम जुड़ जाएगा */
      gv.linkedUserId = user.id;
      gv.linkedName = user.name;
      continue;
    }
    delete e.votes[key];
    e.votes[user.id] = {
      c: gv.c,
      at: gv.at || Date.now(),
      device: gv.device || device,
      guest: false,
      adoptedAt: Date.now(),
    };
    if (e.devices && e.devices[device]) e.devices[device].userId = user.id;
    adopted++;
  }
  return adopted;
}

function deviceKeyFrom(req, bodyDevice) {
  const device = clean(bodyDevice || req.headers['x-device-id'] || '', 80);
  if (device && /^[A-Za-z0-9_-]{8,80}$/.test(device)) return 'd:' + sha256(device).slice(0, 40);
  const ip = clientIp(req);
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
/* असली client IP — X-Forwarded-For spoof se bachne ke liye.
   Cloudflare/Render proxy asli IP ko list ke AAKHIR me jodta hai, aur
   CF-Connecting-IP ko Cloudflare khud likhta hai (client badal nahi sakta).
   Pehle hum XFF ka PEHLA value lete the — wo client apne mann se bhej sakta
   tha, isliye rate-limit bypass ho raha tha. */
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  /* proxy asli IP ko list ke AAKHIR me jodta hai — pehla value client ka
     bheja hua (spoof) ho sakta hai, isliye pehle AAKHIR dekhte hain */
  if (xff.length) return xff[xff.length - 1];
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cf) return cf;
  return String(req.socket.remoteAddress || 'unknown');
}

/* कुछ sensitive cheezein (जैसे डेवलपर लॉगिन) पर IP की परवाह किए बिना एक
   global limit भी — ताकि IP बदलकर भी बेतहाशा कोशिश न हो सके */
function globalRateLimit(bucket, max, windowMs) {
  const now = Date.now();
  const key = 'G:' + bucket;
  const e = rateBuckets.get(key) || { count: 0, reset: now + windowMs };
  if (now > e.reset) { e.count = 0; e.reset = now + windowMs; }
  e.count++;
  rateBuckets.set(key, e);
  return e.count <= max;
}

function rateLimit(req, bucket, max, windowMs = 60000) {
  const ip = clientIp(req);
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
      app: APP_VERSION,
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

    /* 🔒 एक मोबाइल/डिवाइस = एक नाम (कोई दूसरा नाम इसी डिवाइस से लॉगिन नहीं कर सकता) */
    if (!db.deviceOwner) db.deviceOwner = {};
    const ownerId = db.deviceOwner[device];
    if (ownerId && ownerId !== user.id) {
      const owner = db.users.find((u) => u.id === ownerId);
      return sendJson(res, 403, {
        error: `इस मोबाइल से पहले ${owner ? '"' + owner.name + '"' : 'किसी और'} नाम से लॉगिन हो चुका है। एक मोबाइल = एक नाम। उसी नाम से लॉगिन करें या दूसरा मोबाइल इस्तेमाल करें।`,
        code: 'DEVICE_TAKEN',
        ownerName: owner ? owner.name : null,
      });
    }
    db.deviceOwner[device] = user.id;
    /* 🧬 फिंगरप्रिंट भी इसी नाम से बाँध दो (डेटा मिटने पर पहचान बची रहे) */
    const fp = fpKeyFrom(req);
    if (fp) {
      if (!db.fpOwner) db.fpOwner = {};
      db.fpOwner[fp] = user.id;
    }

    user.devices[device] = Date.now();
    if (Object.keys(user.devices).length > 40) {
      const entries = Object.entries(user.devices).sort((a, b) => b[1] - a[1]).slice(0, 40);
      user.devices = Object.fromEntries(entries);
    }

    /* इस फ़ोन से पहले बिना लॉगिन जो वोट पड़े थे, उन पर अब इसका नाम लग जाए */
    const adopted = adoptGuestVotes(user, device);

    const token = rid(24);
    user.tokens[token] = Date.now();
    const tokens = Object.entries(user.tokens).sort((a, b) => b[1] - a[1]).slice(0, 12);
    user.tokens = Object.fromEntries(tokens);

    await saveNow();
    return sendJson(res, 200, { user: publicUser(user), token, quota: quotaFor(user), adoptedVotes: adopted });
  }

  /* =====================================================================
     🟢 अपने आप लॉगिन (auto-login)
     इस फ़ोन से जो एक बार लॉगिन कर चुका है, उसे फिर से नाम न लिखना पड़े —
     लॉगआउट, ब्राउज़र बंद, फ़ोन रीस्टार्ट के बाद भी वही खाता मिल जाए।
     ब्राउज़र का डेटा पूरा मिट जाए तो फिंगरप्रिंट से सिर्फ़ "सुझाव" मिलता है
     (एक टैप में लॉगिन) — बिना पूछे किसी और के खाते में नहीं डालते।
     ===================================================================== */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'auto') {
    const body = await readBody(req);
    const device = deviceKeyFrom(req, body.deviceId);
    const fp = fpKeyFrom(req);
    if (!db.deviceOwner) db.deviceOwner = {};
    if (!db.fpOwner) db.fpOwner = {};

    const byDevice = db.deviceOwner[device];
    const byFp = fp ? db.fpOwner[fp] : null;
    const ownerId = byDevice || byFp;
    const owner = ownerId ? db.users.find((u) => u.id === ownerId) : null;
    if (!owner || owner.deletedAt) {
      return sendJson(res, 200, { ok: false, hint: null });
    }

    /* डेटा मिट चुका है (device नया, सिर्फ़ फिंगरप्रिंट मिला) → पूछकर लॉगिन */
    if (!byDevice) {
      return sendJson(res, 200, {
        ok: false,
        hint: { name: owner.name, via: 'fingerprint' },
        message: 'इस फ़ोन से पहले "' + owner.name + '" नाम से लॉगिन हुआ था।',
      });
    }

    /* यही फ़ोन — सीधे लॉगिन (बिना लॉगिन वाले वोट भी नाम से जोड़ दो) */
    adoptGuestVotes(owner, device);
    const token = rid(24);
    owner.tokens[token] = Date.now();
    owner.lastLoginAt = Date.now();
    const keep = Object.entries(owner.tokens).sort((a, b) => b[1] - a[1]).slice(0, 12);
    owner.tokens = Object.fromEntries(keep);
    if (fp) db.fpOwner[fp] = owner.id;
    await saveNow();
    return sendJson(res, 200, { ok: true, user: publicUser(owner), token, quota: quotaFor(owner), auto: true });
  }

  /* ---------- device rebind: is mobile ka na
     agar kisi ne galti se doosra naam likh diya, to purana naam likhkar badal sakta hai ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'rebind') {
    if (!rateLimit(req, 'rebind', 5, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा प्रयास। 10 मिनट बाद कोशिश करें।' });
    }
    const body = await readBody(req);
    const device = deviceKeyFrom(req, body.deviceId);
    if (!db.deviceOwner) db.deviceOwner = {};
    const ownerId = db.deviceOwner[device];
    if (!ownerId) {
      return sendJson(res, 400, { error: 'इस मोबाइल पर कोई नाम बँधा नहीं है। सीधे लॉगिन करें।', code: 'NOT_BOUND' });
    }
    const owner = db.users.find((u) => u.id === ownerId);
    const typedOld = nameKey(clean(body.oldName, 40));
    const realOld = owner && !owner.deletedAt ? nameKey(owner.name) : null;

    /* पुराना नाम सही लिखने पर ही बदलेगा — बिना जानकारी कोई दूसरा नहीं बदल सकता */
    const okOld = realOld ? typedOld === realOld : true; // खाता हट चुका हो तो रोक नहीं
    if (!okOld) {
      return sendJson(res, 403, {
        error: 'इस मोबाइल से जुड़ा पुराना नाम ग़लत है। वही नाम लिखें जिससे इस मोबाइल पर लॉगिन हुआ था।',
        code: 'OLD_NAME_MISMATCH',
        ownerName: owner && !owner.deletedAt ? owner.name : null,
      });
    }

    delete db.deviceOwner[device];
    if (owner && owner.devices) delete owner.devices[device];
    /* फिंगरप्रिंट की बाँध भी हटाओ, वरना नाम बदलने के बाद भी पुराना नाम अटकेगा */
    if (db.fpOwner) Object.keys(db.fpOwner).forEach((k) => { if (db.fpOwner[k] === ownerId) delete db.fpOwner[k]; });
    await saveNow();
    return sendJson(res, 200, { ok: true, freedFrom: realOld ? owner.name : null });
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
    list.forEach((e) => syncElection(e));
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
    const durationMin = normalizeDuration(
      body.durationMin != null ? body.durationMin : DEFAULT_DURATION_MIN
    );
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
      /* ---------- timer ---------- */
      durationMin,
      endsAt: Date.now() + durationMin * 60000,
      autoClosed: false,
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
  if (method === 'GET' && parts[1] === 'elections' && code && parts.length === 3 && !election) {
    /* galat ya delete ho chuka code — saaf message (pehle "API नहीं मिली" aata tha) */
    return sendJson(res, 404, { error: 'यह चुनाव नहीं मिला — हो सकता है हटा दिया गया हो या कोड ग़लत हो।', code: 'ELECTION_NOT_FOUND' });
  }

  if (method === 'GET' && election && parts.length === 3) {
    syncElection(election);
    /* लॉगिन न हो तो भी उस डिवाइस का वोट दिखे (hasVoted/myVote) */
    const who = viewer || { id: guestVoterId(req), name: 'मेहमान मतदाता', guest: true };
    return sendJson(res, 200, publicElection(election, who));
  }

  /* ---------- election: vote ---------- */
  if (method === 'POST' && election && parts[3] === 'vote') {
    syncElection(election);   /* समय पूरा हो गया हो तो अभी बंद करो */
    if (election.closed) {
      return sendJson(res, 403, { error: 'यह चुनाव समाप्त हो चुका है, अब वोट नहीं डाला जा सकता।' });
    }
    if (!rateLimit(req, 'vote', 150, 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा अनुरोध। थोड़ी देर बाद प्रयास करें।' });
    }
    const body = await readBody(req);
    const candidateId = clean(body.candidateId, 40);
    const device = deviceKeyFrom(req, body.deviceId);
    /* लॉगिन है तो उसका खाता, वरना यह डिवाइस ही मतदाता है */
    const voterId = viewer ? viewer.id : 'g:' + device;
    const voterName = viewer ? viewer.name : 'मेहमान मतदाता';

    const cand = election.candidates.find((c) => c.id === candidateId);
    if (!cand) return sendJson(res, 400, { error: 'उम्मीदवार नहीं मिला।' });

    if (election.votes[voterId]) {
      return sendJson(res, 409, {
        error: 'आप इस चुनाव में पहले ही वोट कर चुके हैं।',
        code: 'ALREADY_VOTED',
        election: publicElection(election, { id: voterId, name: voterName }),
      });
    }
    /* 🧬 इस फ़ोन से इस चुनाव में पहले ही वोट हो चुका है? (इनकॉग्निटो/दूसरा ब्राउज़र)
       — पहले रोकते हैं और साफ़ संदेश देते हैं। अगर सच में दूसरा व्यक्ति है
       (एक ही मॉडल का दूसरा फ़ोन), तो वह "मैं दूसरा व्यक्ति हूँ" दबाकर वोट कर सकता है
       — और वह वोट डेवलपर को अलग से दिख जाता है। */
    const fpNow = fpKeyFrom(req);
    const fpAlready = !!(fpNow && election.fpVotes && election.fpVotes[fpNow] && election.fpVotes[fpNow].length);
    if (fpAlready && body.overrideSamePhone !== true) {
      return sendJson(res, 409, {
        error: 'इस फ़ोन से इस चुनाव में पहले ही वोट दिया जा चुका है। एक फ़ोन से एक ही वोट मान्य है।',
        code: 'SAME_PHONE_VOTED',
        allowOverride: true,
        election: publicElection(election, { id: voterId, name: voterName }),
      });
    }
    if (fpAlready && body.overrideSamePhone === true && election.votes[voterId]) {
      /* एक ही व्यक्ति (खाता) दोबारा — यह कभी नहीं */
      return sendJson(res, 409, {
        error: 'आप इस चुनाव में पहले ही वोट कर चुके हैं।',
        code: 'ALREADY_VOTED',
      });
    }

    const dev = election.devices[device];
    if (dev) {
      return sendJson(res, 409, {
        error: 'इस फ़ोन/डिवाइस से इस चुनाव में वोट दिया जा चुका है। एक डिवाइस से सिर्फ़ एक ही वोट मान्य है।',
        code: 'DEVICE_VOTED',
        election: publicElection(election, { id: voterId, name: voterName }),
      });
    }

    const fpV = fpKeyFrom(req);
    election.votes[voterId] = { c: cand.id, at: Date.now(), device, guest: !viewer, fp: fpV, samePhoneOverride: (fpAlready && body.overrideSamePhone === true) };
    election.devices[device] = { userId: voterId, at: Date.now() };
    /* 🧬 एक ही फ़ोन से कई वोट? — डेवलपर को दिखाने के लिए गिनते हैं (रोकते नहीं,
       वरना एक ही मॉडल के दो असली फ़ोन का सही वोट भी रुक जाए) */
    if (fpV) {
      if (!election.fpVotes) election.fpVotes = {};
      if (!election.fpVotes[fpV]) election.fpVotes[fpV] = [];
      if (!election.fpVotes[fpV].includes(voterId)) election.fpVotes[fpV].push(voterId);
    }
    await saveNow();

    // 🔴 real-time: election subscribers ko naya tally + developer ko live vote
    const fresh = publicElection(election, null);
    broadcastElection(election.code, { election: fresh });
    broadcastDev('vote', {
      at: election.votes[voterId].at,
      userName: voterName,
      userId: voterId,
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
      election: publicElection(election, { id: voterId, name: voterName }),
    });
  }

  /* ---------- election: close / reopen (creator or developer) ---------- */
  if (method === 'POST' && election && (parts[3] === 'close' || parts[3] === 'reopen')) {
    const isCreator = !!viewer && election.creatorId === viewer.id;
    const isDev = devTokenValid(req);
    if (!isCreator && !isDev) {
      return sendJson(res, 403, { error: 'सिर्फ़ चुनाव बनाने वाला (या डेवलपर) इसे बंद कर सकता है।' });
    }

    /* 🔒 नियम: निर्माता तय समय से पहले न बंद कर सकता, न खोल सकता */
    if (!isDev) {
      if (parts[3] === 'close' && isLocked(election)) {
        const left = Math.ceil(remainingMs(election) / 60000);
        return sendJson(res, 403, {
          error: `यह चुनाव तय समय तक चलेगा — अभी ${left} मिनट बाकी हैं। समय पूरा होते ही अपने आप बंद हो जाएगा।`,
          code: 'TIMER_ACTIVE',
          remainingMs: remainingMs(election),
          endsAt: election.endsAt,
        });
      }
      if (parts[3] === 'reopen' && election.endsAt && isTimeUp(election)) {
        return sendJson(res, 403, {
          error: 'जिस चुनाव का समय पूरा हो गया, उसे दोबारा नहीं खोला जा सकता। नया चुनाव बनाइए।',
          code: 'TIMER_OVER',
        });
      }
    }

    syncElection(election);
    election.closed = parts[3] === 'close';
    election.closedAt = election.closed ? Date.now() : null;
    await saveNow();
    const payload = publicElection(election, null);
    broadcastElection(election.code, { election: payload });
    broadcastDev('election-status', { code: election.code, closed: election.closed, at: Date.now() });
    return sendJson(res, 200, publicElection(election, viewer));
  }

  /* ---------- election: delete (creator after timer ends / developer anytime) ---------- */
  if (method === 'POST' && election && parts[3] === 'delete') {
    const isCreator = !!viewer && election.creatorId === viewer.id;
    const isDev = devTokenValid(req);

    if (!isCreator && !isDev) {
      return sendJson(res, 403, { error: 'सिर्फ़ चुनाव बनाने वाला ही इसे हटा सकता है।' });
    }
    syncElection(election);

    /* 🔒 चुनाव चलते समय (टाइमर बाकी) निर्माता उसे नहीं हटा सकता */
    if (!isDev && isLocked(election)) {
      const left = Math.ceil(remainingMs(election) / 60000);
      return sendJson(res, 403, {
        error: `चुनाव अभी चल रहा है — ${left} मिनट बाकी हैं। समय पूरा होने के बाद ही हटा सकते हैं।`,
        code: 'TIMER_ACTIVE',
        remainingMs: remainingMs(election),
        endsAt: election.endsAt,
      });
    }

    const idx = db.elections.findIndex((e) => e.code === election.code);
    if (idx === -1) return sendJson(res, 404, { error: 'चुनाव नहीं मिला।' });
    db.elections.splice(idx, 1);
    await saveNow();
    broadcastDev('election-deleted', { code: election.code, by: isDev ? 'developer' : 'creator', at: Date.now() });
    broadcastElection(election.code, { deleted: true, code: election.code });
    return sendJson(res, 200, { ok: true, deleted: election.code });
  }

  /* ---------- my area ---------- */
  if (method === 'GET' && parts[1] === 'me' && parts[2] === 'overview') {
    if (!viewer) return sendJson(res, 401, { error: 'लॉगिन नहीं है।', code: 'LOGIN_REQUIRED' });
    db.elections.forEach((e) => syncElection(e));
    const nowTs = Date.now();
    const myElections = db.elections
      .filter((e) => e.creatorId === viewer.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({
        ...publicSummary(e),
        leading: tally(e).candidates[0] || null,
        canManage: true,
        canDelete: !!(e.closed || !e.endsAt || isTimeUp(e, nowTs)),
        remainingMs: remainingMs(e, nowTs),
      }));
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

    /* इस डिवाइस की बाँध (binding) भी हटाओ, वरना वह मोबाइल हमेशा के लिए
       "इस मोबाइल से पहले ... लॉगिन हो चुका है" पर अटक जाएगा */
    if (db.deviceOwner) {
      Object.keys(db.deviceOwner).forEach((d) => {
        if (db.deviceOwner[d] === viewer.id) delete db.deviceOwner[d];
      });
    }
    if (db.fpOwner) {
      Object.keys(db.fpOwner).forEach((k) => { if (db.fpOwner[k] === viewer.id) delete db.fpOwner[k]; });
    }

    await saveNow();
    broadcastDev('user-deleted', { userId: viewer.id, at: Date.now() });
    return sendJson(res, 200, { ok: true, message: 'आपका खाता हटा दिया गया। आपके वोटों की गिनती बरकरार रहेगी (बिना नाम के)।' });
  }

  /* ================= developer API ================= */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'login') {
    if (!rateLimit(req, 'devlogin', 8, 10 * 60000) || !globalRateLimit('devlogin', 40, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा प्रयास। 10 मिनट बाद कोशिश करें।' });
    }
    if (!DEV_PASSWORD) {
      return sendJson(res, 503, { error: 'डेवलपर पैनल बंद है (DEV_PASSWORD सेट नहीं है)।' });
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
    const ip = clientIp(req);
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
    const ip = clientIp(req);
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
          endsAt: e.endsAt || null,
          durationMin: e.durationMin || 0,
          remainingMs: remainingMs(e),
          timeUp: isTimeUp(e),
          leading: t.candidates[0] || null,
          winner: e.closed ? (t.candidates[0] || null) : null,
          samePhoneVotes: Object.values(e.fpVotes || {}).filter((l) => l.length > 1).length,
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
          userName: u ? u.name : (v && v.linkedName ? v.linkedName : (String(uid).startsWith('g:') ? 'मेहमान मतदाता' : 'अज्ञात उपयोगकर्ता')),
          linkedName: (v && v.linkedName) || null,
          userIsDemo: u ? !!u.isDemo : false,
          electionCode: e.code,
          electionTitle: e.title,
          electionDemo: !!e.isDemo,
          candidateId: cand ? cand.id : null,
          candidateName: cand ? cand.name : '—',
          candidateSymbol: cand ? cand.symbol || 'diya' : 'diya',
          candidateParty: cand ? cand.party || '' : '',
          adopted: !!(v && v.adoptedAt),
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
      activeElections: db.elections.filter((e) => !e.closed).length,
      closedElections: db.elections.filter((e) => !!e.closed).length,
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
          userName: u ? u.name : (v && v.linkedName ? v.linkedName : (String(uid).startsWith('g:') ? 'मेहमान मतदाता' : 'अज्ञात')),
          userIsDemo: u ? !!u.isDemo : false,
          linkedName: (v && v.linkedName) || null,
          adopted: !!(v && v.adoptedAt),
          candidateName: cand ? cand.name : '—',
          candidateSymbol: cand ? cand.symbol || 'diya' : 'diya',
          deviceShort: v && v.device ? String(v.device).slice(0, 10) : '',
        };
      })
      .sort((a, b) => b.at - a.at);
    const samePhone = Object.entries(e.fpVotes || {})
      .filter(([, list]) => list.length > 1)
      .map(([fp, list]) => ({ fpShort: String(fp).slice(0, 12), count: list.length }));
    return sendJson(res, 200, {
      samePhoneVotes: samePhone,
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

  /* 🔴 डेवलपर: कोई भी चुनाव, कभी भी (चलता हुआ हो या पूरा) — साइट से हटा सकता है।
     सिर्फ़ डेवलपर के पास यह ताक़त है; बनाने वाला टाइमर के बीच में नहीं हटा सकता। */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'elections' && parts[4] === 'delete') {
    const target = clean(parts[3], 16).toUpperCase();
    const idx = db.elections.findIndex((e) => e.code === target);
    if (idx === -1) return sendJson(res, 404, { error: 'चुनाव नहीं मिला।', code: 'ELECTION_NOT_FOUND' });
    const gone = db.elections[idx];
    db.elections.splice(idx, 1);
    await saveNow();
    /* खुले हुए मतदाताओं को तुरंत पता चले + फ़ीड में दिखे */
    broadcastElection(target, { deleted: true, code: target });
    broadcastDev('election-deleted', {
      at: Date.now(), code: target, title: gone.title,
      by: 'developer', totalVotes: Object.keys(gone.votes || {}).length,
    });
    return sendJson(res, 200, {
      ok: true, deleted: target,
      message: 'चुनाव साइट से हटा दिया गया (डेवलपर द्वारा)।',
    });
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
    'Content-Type, x-user-token, x-dev-token, x-device-id, x-fp'
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
  /* ⏱️ टाइमर वाला चुनाव अपने आप बंद — 20 सेकंड में एक बार जाँच।
     इससे जो लोग पेज खोले बैठे हैं उन्हें बिना रीलोड "समाप्त" दिख जाता है। */
  setInterval(() => {
    for (const e of db.elections) {
      if (!e.closed && isTimeUp(e)) {
        syncElection(e);
        broadcastElection(e.code, { election: publicElection(e, null) });
        broadcastDev('election-closed', {
          at: Date.now(), code: e.code, title: e.title, auto: true,
          totalVotes: Object.keys(e.votes || {}).length,
        });
      }
    }
  }, 20000).unref?.();

  /* =====================================================================
     🧹 एक बार चलने वाली सफ़ाई (25 अक्टूबर 2026)
     ऑडिट के दौरान ग़लती से लाइव साइट पर जो टेस्ट चुनाव/टेस्ट खाते बने थे,
     उन्हें हटाता है। असली यूज़र का डेटा नहीं छूता — कड़ी शर्तें लगी हैं:
       • चुनाव: बिल्कुल वही कोड + बिल्कुल वही गाँव का नाम + 0 वोट
       • खाते: ठीक वही टेस्ट नाम + कोई चुनाव नहीं + कोई वोट नहीं
     एक बार चलने के बाद दोबारा नहीं चलेगा (db.migrations में निशान)।
     ===================================================================== */
  (async () => {
    const KEY = 'cleanup-test-data-2026-10-25';
    if (!db.migrations) db.migrations = {};
    if (db.migrations[KEY]) return;
    let eRemoved = 0, uRemoved = 0;
    const i = db.elections.findIndex((e) => e.code === '4TDPPF' && e.gram === 'ज़िप गाँव' && Object.keys(e.votes || {}).length === 0);
    if (i !== -1) { db.elections.splice(i, 1); eRemoved++; }
    const TEST_NAMES = new Set(['अंतिम जाँच', 'नया व्यक्ति लाइव', 'घड़ी जाँच', 'जाँच टीम', 'लाइव अंतिम', 'कोई और']);
    db.users = db.users.filter((u) => {
      const n = String(u.name || '');
      const isTest = TEST_NAMES.has(n) || /^ज़िप वाला \d+$/.test(n) || /^लिंक वाला \d+$/.test(n) || /^ऑटो टेस्ट \d+$/.test(n) || /^समय परख \d+$/.test(n) || /^लाइव बंद \d+$/.test(n) || /^बंद चुनाव वाला \d+$/.test(n);
      if (!isTest) return true;
      const hasElection = db.elections.some((e) => e.creatorId === u.id);
      const hasVote = db.elections.some((e) => e.votes && e.votes[u.id]);
      if (hasElection || hasVote) return true;
      if (db.deviceOwner) Object.keys(db.deviceOwner).forEach((d) => { if (db.deviceOwner[d] === u.id) delete db.deviceOwner[d]; });
      uRemoved++;
      return false;
    });
    db.migrations[KEY] = Date.now();
    if (eRemoved || uRemoved) {
      await saveNow();
      console.log(`🧹 सफ़ाई: ${eRemoved} टेस्ट चुनाव, ${uRemoved} टेस्ट खाते हटाए (असली डेटा अछूता)`);
    }
  })();

  server.listen(PORT, '0.0.0.0', () => {
    console.log('──────────────────────────────────────────────');
    console.log('🗳️  जनमत (Janmat) server v2');
    if (!DEV_PASSWORD) {
      console.log('🔒 DEV_PASSWORD सेट नहीं है — डेवलपर पैनल बंद रहेगा (Render → Environment में डालें)');
    } else if (DEV_PASSWORD === 'KHOHDEEG') {
      console.log('⚠️  DEV_PASSWORD पुराना/default है — बदल दें (यह repo/डॉक्स में सार्वजनिक था)');
    }
    console.log(`   URL      : http://0.0.0.0:${PORT}`);
    console.log(`   Storage  : ${storageMode === 'redis' ? 'Upstash Redis (permanent)' : 'local file data/db.json'}`);
    console.log(`   Elections: ${db.elections.length} | Users: ${db.users.length}`);
    console.log(`   Daily election limit per user: ${DAILY_ELECTION_LIMIT}`);
    console.log('──────────────────────────────────────────────');
  });
})();

/* ⏱️ हर 20 सेकंड: जिन चुनावों का समय पूरा हो गया, उन्हें अपने आप बंद करो
   और जुड़े हुए सब लोगों को तुरंत बता दो (कोई मैन्युअल काम नहीं) */
const expiryTimer = setInterval(() => {
  try {
    const nowTs = Date.now();
    let dirty = false;
    for (const e of db.elections) {
      if (!e.closed && isTimeUp(e, nowTs)) {
        e.closed = true;
        e.closedAt = e.endsAt;
        e.autoClosed = true;
        dirty = true;
        try { broadcastElection(e.code, { election: publicElection(e, null) }); } catch (_) {}
        try { broadcastDev('election-status', { code: e.code, closed: true, auto: true, at: nowTs }); } catch (_) {}
      }
    }
    if (dirty) save();
  } catch (_) {}
}, 20000);
if (expiryTimer.unref) expiryTimer.unref();

process.on('SIGINT', async () => { try { await persistNow(); } catch (_) {} process.exit(0); });
process.on('SIGTERM', async () => { try { await persistNow(); } catch (_) {} process.exit(0); });
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e && e.message));
