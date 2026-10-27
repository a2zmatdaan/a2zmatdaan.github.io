'use strict';

/* =====================================================================
   जनमत (Janmat) — server v2
   ---------------------------------------------------------------------
   Features
   • Naam + Unique Username + PIN login (v8 — bina mobile/email; har username duniya me ek)
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

/* =====================================================================
   🔐 नाम + पासवर्ड सुरक्षा (v7.1)
   • पासवर्ड/रिकवरी कोड कभी plain नहीं रखा जाता — scrypt hash + salt।
   • एक जैसे नाम के कई खाते रह सकते हैं; पहचान पासवर्ड से होती है।
   • मोबाइल नंबर/ईमेल/OTP का इस्तेमाल बिल्कुल नहीं होता।
   ===================================================================== */
const PW_MIN = 6;
const PW_MAX = 64;

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(secret), salt, 64).toString('hex');
  return 'scrypt:' + salt + ':' + hash;
}
function verifySecret(secret, stored) {
  try {
    const parts = String(stored || '').split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const expected = Buffer.from(parts[2], 'hex');
    const got = crypto.scryptSync(String(secret), parts[1], 64);
    return expected.length === got.length && crypto.timingSafeEqual(expected, got);
  } catch (_) { return false; }
}
function validateName(rawName) {
  const name = clean(rawName, 30);
  if (!name) return { error: 'अपना नाम लिखें।' };
  if (name.length < 2) return { error: 'नाम कम से कम 2 अक्षरों का होना चाहिए।' };
  if (!/^[\p{L}\p{M}\p{N} .'_-]+$/u.test(name)) {
    return { error: 'नाम में सिर्फ अक्षर, अंक, स्पेस और . \' _ - चलेंगे।' };
  }
  if (RESERVED_NAMES.has(nameKey(name))) {
    return { error: 'यह नाम आरक्षित है, कृपया दूसरा नाम चुनें।' };
  }
  return { name };
}
function validatePassword(password, name) {
  const pw = String(password == null ? '' : password);
  if (pw.length < PW_MIN) return { error: 'पासवर्ड कम से कम ' + PW_MIN + ' अक्षरों का रखें।' };
  if (pw.length > PW_MAX) return { error: 'पासवर्ड ज़्यादा से ज़्यादा ' + PW_MAX + ' अक्षरों का रखें।' };
  if (!pw.trim()) return { error: 'पासवर्ड खाली नहीं हो सकता।' };
  if (name && nameKey(pw) === nameKey(name)) return { error: 'पासवर्ड अपने नाम जैसा न रखें — कोई अलग गुप्त शब्द चुनें।' };
  return { password: pw };
}

/* 🔢 गुप्त PIN — सिर्फ़ 6 से 10 अंक (नया खाता/PIN बदलते समय यही नियम;
   पुराने बने पासवर्ड लॉगिन में वैसे ही चलेंगे, उन पर यह नियम लागू नहीं) */
const COMMON_PINS = new Set(['123456','654321','1234567','12345678','123456789','1234567890','987654','9876543210','112233','121212','123123','111111','000000','102030','246810','135790','5201314']);
function validatePin(pin, username) {
  const s = String(pin == null ? '' : pin);
  if (!/^[0-9]{6,10}$/.test(s)) return { error: 'PIN सिर्फ़ 6 से 10 अंकों का रखें (सिर्फ़ नंबर 0–9)।' };
  if (/^([0-9])\1+$/.test(s)) return { error: 'PIN में सारे अंक एक जैसे न रखें — कुछ अलग चुनें।' };
  let asc = true, desc = true;
  for (let i = 1; i < s.length; i++) {
    const d = Number(s[i]) - Number(s[i - 1]);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  if (asc || desc || COMMON_PINS.has(s)) return { error: 'यह PIN बहुत आम है (जैसे 123456) — कोई ऐसा नंबर चुनें जो सिर्फ़ आपको याद रहे।' };
  if (username && String(username).includes(s)) return { error: 'PIN अपने username जैसा न रखें।' };
  return { password: s };
}

/* 👤 Username — दुनिया भर में एक, हमेशा के लिए उसी खाते का */
const RESERVED_USERNAMES = new Set(['developer','dev','admin','administrator','janmat','a2zjanmat','teamjanmat','janmat_team','moderator','root','support','help','official','election','vote','electioncommission','jansunwai','pawan_admin']);
function normalizeUsername(raw) {
  return String(raw == null ? '' : raw).trim().toLowerCase().replace(/^@+/, '').replace(/\s+/g, '_');
}
function validateUsername(raw) {
  const u = normalizeUsername(raw);
  if (!u) return { error: 'अपना username चुनें — यही आपकी असली login-ID होगी।' };
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(u)) {
    return { error: 'Username 3–20 अक्षरों का रखें: शुरुआत अंग्रेज़ी अक्षर (a–z) से, फिर अक्षर, अंक या _ चलेंगे (जैसे pawan_verma)।' };
  }
  if (u.includes('__') || u.endsWith('_')) return { error: 'Username में लगातार दो _ या अंत में _ न रखें।' };
  if (RESERVED_USERNAMES.has(u)) return { error: 'यह username आरक्षित है, कृपया दूसरा चुनें।' };
  return { username: u };
}
function maskUsername(u) {
  const s = String(u || '');
  if (s.length <= 3) return s ? s[0] + '***' : null;
  return s.slice(0, 2) + '***' + s.slice(-2);
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeRecoveryCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += RECOVERY_ALPHABET[crypto.randomBytes(1)[0] % RECOVERY_ALPHABET.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}
function normalizeRecovery(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function setPasswordAndRecovery(user, password) {
  const code = makeRecoveryCode();
  user.pwHash = hashSecret(password);
  user.pwSetAt = Date.now();
  user.recoveryHash = hashSecret(normalizeRecovery(code));
  user.recoverySetAt = Date.now();
  return code;
}

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
let persistQueue = Promise.resolve();   /* Redis writes को क्रम में रखता है */
let storageMode = USE_REDIS ? 'redis' : 'file';

/* 📊 महीने की असली Redis command गिनती (डेव पैनल के usage meter के लिए)
   हर सफल Redis request = 1 command. Upstash limit: 5,00,000/महीना. */
function istMonthKey(ts = Date.now()) {
  return istDayKey(ts).slice(0, 7);   /* YYYY-MM */
}
function bumpRedisCmd() {
  if (!db) return;
  const m = istMonthKey();
  if (!db.meta || typeof db.meta !== 'object') db.meta = { month: m, cmds: 0 };
  if (db.meta.month !== m) { db.meta.month = m; db.meta.cmds = 0; }
  db.meta.cmds = (Number(db.meta.cmds) || 0) + 1;
}

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
  const out = await res.json();
  try { bumpRedisCmd(); } catch (_) {}
  return out;
}

/* 🔁 पुराने DB में नए हिस्से जोड़ दो (data कभी नहीं मिटता) */
function migrateDb(d) {
  if (!d || typeof d !== 'object') return d;
  if (!Array.isArray(d.complaints)) d.complaints = [];
  if (!Array.isArray(d.users)) d.users = [];
  if (!Array.isArray(d.elections)) d.elections = [];
  if (!d.devSessions || typeof d.devSessions !== 'object') d.devSessions = {};
  if (!d.deviceOwner || typeof d.deviceOwner !== 'object') d.deviceOwner = {};
  if (!d.fpOwner || typeof d.fpOwner !== 'object') d.fpOwner = {};
  if (!Array.isArray(d.accountApplications)) d.accountApplications = [];
  if (!d.deviceAccounts || typeof d.deviceAccounts !== 'object') d.deviceAccounts = {};
  if (!d.fpAccounts || typeof d.fpAccounts !== 'object') d.fpAccounts = {};
  for (const u of d.users) {
    if (!u || typeof u !== 'object') continue;
    if (typeof u.username !== 'string') u.username = u.username ? String(u.username) : null;
    if (!u.accountStatus) u.accountStatus = u.deletedAt ? 'deleted' : 'active';
    if (!u.devices || typeof u.devices !== 'object') u.devices = {};
    for (const dk of Object.keys(u.devices)) {
      if (!Array.isArray(d.deviceAccounts[dk])) d.deviceAccounts[dk] = [];
      if (!d.deviceAccounts[dk].includes(u.id)) d.deviceAccounts[dk].push(u.id);
    }
  }
  for (const [dk, uid] of Object.entries(d.deviceOwner)) {
    if (!Array.isArray(d.deviceAccounts[dk])) d.deviceAccounts[dk] = [];
    if (uid && !d.deviceAccounts[dk].includes(uid)) d.deviceAccounts[dk].push(uid);
  }
  for (const [fk, uid] of Object.entries(d.fpOwner)) {
    if (!Array.isArray(d.fpAccounts[fk])) d.fpAccounts[fk] = [];
    if (uid && !d.fpAccounts[fk].includes(uid)) d.fpAccounts[fk].push(uid);
  }
  if (!d.meta || typeof d.meta !== 'object') d.meta = { month: istMonthKey(), cmds: 0 };
  if (typeof d.meta.cmds !== 'number') d.meta.cmds = 0;
  if (!d.meta.month) d.meta.month = istMonthKey();
  return d;
}

async function loadDb() {
  if (USE_REDIS) {
    try {
      const out = await redisRequest('/get/' + encodeURIComponent(REDIS_KEY));
      if (out && typeof out.result === 'string' && out.result) {
        const parsed = JSON.parse(out.result);
        if (parsed && parsed.version === 2) {
          console.log('📦 loaded from Upstash Redis');
          return migrateDb(parsed);
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
    if (parsed && parsed.version === 2) return migrateDb(parsed);
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
  /* 🔒 एक-एक करके save करो। वरना समानांतर vote/signup के समय पुराना Redis
     snapshot नए snapshot के बाद पहुँचकर ताज़ा डेटा पीछे धकेल सकता था।
     Snapshot queue की बारी आने पर बनता है, इसलिए हमेशा ताज़ा स्थिति जाती है। */
  const run = async () => {
    if (USE_REDIS && storageMode === 'redis') {
      try {
        await redisRequest('/set/' + encodeURIComponent(REDIS_KEY), JSON.stringify(data || db));
        return;
      } catch (err) {
        console.error('Redis save failed:', err.message);
      }
    }
    writeFileDb(data || db);
  };
  persistQueue = persistQueue.then(run, run);
  return persistQueue;
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
    return { version: 2, createdAt: now, users: [], elections: [], devSessions: {}, deviceOwner: {}, fpOwner: {}, complaints: [], meta: { month: istMonthKey(now), cmds: 0 } };
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

function tokenTime(rec) {
  if (typeof rec === 'number') return rec;
  return Number((rec && rec.createdAt) || 0);
}
function pruneUserTokens(user) {
  if (!user || !user.tokens || typeof user.tokens !== 'object') { if (user) user.tokens = {}; return; }
  const now = Date.now();
  for (const [k, rec] of Object.entries(user.tokens)) {
    const exp = rec && typeof rec === 'object' ? Number(rec.expiresAt || 0) : tokenTime(rec) + SESSION_DAYS * 864e5;
    if (!exp || exp <= now) delete user.tokens[k];
  }
  const keep = Object.entries(user.tokens).sort((a, b) => tokenTime(b[1]) - tokenTime(a[1])).slice(0, 12);
  user.tokens = Object.fromEntries(keep);
}
function issueToken(user) {
  pruneUserTokens(user);
  const token = rid(24);
  const now = Date.now();
  /* सर्वर पर सिर्फ़ hash रहता है — DB लीक होने पर भी असली token नहीं मिलता */
  user.tokens[sha256(token)] = { createdAt: now, expiresAt: now + SESSION_DAYS * 864e5 };
  pruneUserTokens(user);
  return token;
}
function userByToken(token) {
  if (!token || !/^[a-f0-9]{16,80}$/.test(String(token))) return null;
  const hashed = sha256(String(token));
  const now = Date.now();
  for (const u of db.users) {
    if (!u || !u.pwHash || !u.tokens) continue;   /* बिना-पासवर्ड पुराने सत्र अब मान्य नहीं */
    if ((u.accountStatus || 'active') !== 'active' || u.deletedAt) continue;
    const rec = u.tokens[hashed];
    if (!rec) continue;
    const exp = rec && typeof rec === 'object' ? Number(rec.expiresAt || 0) : tokenTime(rec) + SESSION_DAYS * 864e5;
    if (!exp || exp <= now) { delete u.tokens[hashed]; save(); return null; }
    return u;
  }
  return null;
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

const APP_VERSION = '8.2.4-ui-cleanup';

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
  const existing = db.elections.filter((e) => e.creatorId === user.id && istDayKey(e.createdAt) === today).length;
  /* हटाए गए चुनावों की भी गिनती याद रखो — वरना चुनाव हटाकर उसी दिन
     रोज़-वाली सीमा बार-बार नई की जा सकती थी। पुराने खातों के लिए मौजूद
     चुनावों की संख्या को ही शुरुआती आधार मानते हैं। */
  const recorded = user && user.electionDay === today ? (Number(user.electionDayCount) || 0) : 0;
  const used = Math.max(existing, recorded);
  return {
    limit: DAILY_ELECTION_LIMIT,
    used,
    remaining: Math.max(0, DAILY_ELECTION_LIMIT - used),
    resetsAt: nextIstMidnight(),
  };
}

function publicUser(u) {
  return { id: u.id, name: u.name, username: u.username || null, accountStatus: u.accountStatus || 'active', createdAt: u.createdAt };
}
function isActiveUser(u) {
  return !!(u && !u.deletedAt && (u.accountStatus || 'active') === 'active');
}
function findUserByUsername(username) {
  const u = normalizeUsername(username);
  if (!u) return null;
  return db.users.find((x) => x && x.username && normalizeUsername(x.username) === u) || null;
}
function recordDeviceAccount(user, device, fp) {
  if (!user || !device) return;
  if (!db.deviceAccounts || typeof db.deviceAccounts !== 'object') db.deviceAccounts = {};
  if (!Array.isArray(db.deviceAccounts[device])) db.deviceAccounts[device] = [];
  if (!db.deviceAccounts[device].includes(user.id)) db.deviceAccounts[device].push(user.id);
  if (fp) {
    if (!db.fpAccounts || typeof db.fpAccounts !== 'object') db.fpAccounts = {};
    if (!Array.isArray(db.fpAccounts[fp])) db.fpAccounts[fp] = [];
    if (!db.fpAccounts[fp].includes(user.id)) db.fpAccounts[fp].push(user.id);
  }
}
function deviceConflictUsers(device, fp) {
  const ids = new Set();
  const add = (v) => { if (Array.isArray(v)) v.forEach((x) => x && ids.add(x)); else if (v) ids.add(v); };
  if (device) {
    add(db.deviceAccounts && db.deviceAccounts[device]);
    add(db.deviceOwner && db.deviceOwner[device]);
  }
  if (fp) {
    add(db.fpAccounts && db.fpAccounts[fp]);
    add(db.fpOwner && db.fpOwner[fp]);
  }
  for (const u of db.users) {
    if (u && device && u.devices && u.devices[device]) ids.add(u.id);
  }
  return [...ids].map((id) => findUserById(id)).filter(isActiveUser);
}
function syncApplications() {
  if (!Array.isArray(db.accountApplications)) db.accountApplications = [];
  const now = Date.now();
  let changed = false;
  for (const a of db.accountApplications) {
    if (a && a.status === 'pending' && a.expiresAt && now > a.expiresAt) { a.status = 'expired'; a.decidedAt = now; changed = true; }
  }
  if (changed) save();
}
function usernameTaken(username, exceptUserId) {
  const u = normalizeUsername(username);
  if (!u) return true;
  syncApplications();
  if (db.users.some((x) => x && x.username && normalizeUsername(x.username) === u && x.id !== exceptUserId)) return true;
  return db.accountApplications.some((a) => a && a.status === 'pending' && a.desiredUsername === u);
}
function usernameSuggestions(base) {
  const out = [];
  const root = normalizeUsername(base).replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
  for (let i = 1; i <= 99 && out.length < 3; i++) {
    const cand = (root + (i < 10 ? '0' + i : String(i))).slice(0, 20);
    if (validateUsername(cand).username && !usernameTaken(cand)) out.push(cand);
  }
  return out;
}

/* एक जैसे नाम वाले सभी खाते (हटे हुए छोड़कर) */
function findUsersByName(name) {
  const k = nameKey(name);
  return db.users.filter((u) => u && u.nameLower === k && !u.deletedAt);
}
function orderedCandidates(list, device, fp) {
  const bound = new Set();
  if (db.deviceOwner && db.deviceOwner[device]) bound.add(db.deviceOwner[device]);
  if (fp && db.fpOwner && db.fpOwner[fp]) bound.add(db.fpOwner[fp]);
  return [...list].sort((a, b) =>
    ((bound.has(b.id) ? 1 : 0) - (bound.has(a.id) ? 1 : 0)) ||
    ((b.lastLoginAt || 0) - (a.lastLoginAt || 0)));
}
function findPasswordMatch(candidates, password) {
  let checked = 0;
  for (const u of candidates) {
    if (!u.pwHash) continue;
    if (++checked > 30) break;   /* CPU सुरक्षा: एक नाम पर असीमित जाँच नहीं */
    if (verifySecret(password, u.pwHash)) return u;
  }
  return null;
}
function findRecoveryMatch(candidates, recoveryCode) {
  const code = normalizeRecovery(recoveryCode);
  if (code.length !== 12) return null;
  let checked = 0;
  for (const u of candidates) {
    if (!u.recoveryHash) continue;
    if (++checked > 30) break;
    if (verifySecret(code, u.recoveryHash)) return u;
  }
  return null;
}
function claimableLegacy(candidates, device, fp) {
  /* पुराना बिना-पासवर्ड खाता सिर्फ़ उसी फ़ोन से claim होगा जो पहले से उससे बँधा है */
  return candidates.find((u) => !u.pwHash) && orderedCandidates(candidates, device, fp)
    .find((u) => !u.pwHash && ((db.deviceOwner && db.deviceOwner[device] === u.id) || (fp && db.fpOwner && db.fpOwner[fp] === u.id))) || null;
}
/* सफल login/register/recovery के बाद का साझा काम: device याद + guest वोट जोड़ना + token */
async function completeAuth(req, res, user, body, extra = {}, status = 200) {
  const device = deviceKeyFrom(req, body && body.deviceId);
  if (!db.deviceOwner) db.deviceOwner = {};
  db.deviceOwner[device] = user.id;   /* अब यह सिर्फ़ "इस फ़ोन का आख़िरी खाता" है, रोक नहीं */
  const fp = fpKeyFrom(req);
  if (fp) {
    if (!db.fpOwner) db.fpOwner = {};
    db.fpOwner[fp] = user.id;
  }
  if (!user.devices || typeof user.devices !== 'object') user.devices = {};
  user.devices[device] = Date.now();
  if (Object.keys(user.devices).length > 40) {
    user.devices = Object.fromEntries(Object.entries(user.devices).sort((a, b) => b[1] - a[1]).slice(0, 40));
  }
  recordDeviceAccount(user, device, fp);
  user.lastLoginAt = Date.now();
  const adopted = adoptGuestVotes(user, device);
  const token = issueToken(user);
  await saveNow();
  return sendJson(res, status, { user: publicUser(user), token, quota: quotaFor(user), adoptedVotes: adopted, ...extra });
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
    const mine = e.votes[user.id];
    if (mine) {
      /* दोनों तरफ़ से वोट मिल गया (guest + खाता) — गिनती में सिर्फ़ सबसे पुराना
         एक ही रहेगा; दूसरा mergedVotes में नोट रहेगा ताकि developer को दिखे। */
      const guestOlder = (Number(gv.at) || 0) <= (Number(mine.at) || 0);
      const kept = guestOlder ? gv : mine;
      const dropped = guestOlder ? mine : gv;
      if (!Array.isArray(e.mergedVotes)) e.mergedVotes = [];
      e.mergedVotes.push({
        at: Date.now(), userId: user.id, guestId: key,
        keptCandidate: kept.c || null, droppedCandidate: dropped.c || null,
        reason: 'guest+account same person',
      });
      delete e.votes[key];
      e.votes[user.id] = {
        c: kept.c,
        at: kept.at || Date.now(),
        device: kept.device || device,
        guest: false,
        via: guestOlder ? 'guest' : (mine.via || 'account'),
        sourceGuest: true,
        linkedName: user.name,
        linkedUsername: user.username || null,
        adoptedAt: Date.now(),
      };
      if (e.devices && e.devices[device]) e.devices[device].userId = user.id;
      adopted++;
      continue;
    }
    delete e.votes[key];
    e.votes[user.id] = {
      c: gv.c,
      at: gv.at || Date.now(),
      device: gv.device || device,
      guest: false,
      via: 'guest',
      sourceGuest: true,
      linkedName: user.name,
      linkedUsername: user.username || null,
      originalGuestId: key,
      adoptedAt: Date.now(),
    };
    if (e.devices && e.devices[device]) e.devices[device].userId = user.id;
    adopted++;
  }
  return adopted;
}

/* पुराने खाते को नए खाते में मिलाना (appeal approve पर replacement) — चुनाव/वोट
   नए खाते से जुड़ जाते हैं, पुराना खाता बंद हो जाता है, दो वोट हों तो एक ही गिना जाता है। */
function mergeAccountInto(oldUser, newUser) {
  if (!oldUser || !newUser || oldUser.id === newUser.id) return;
  for (const e of db.elections) {
    if (e.creatorId === oldUser.id) e.creatorId = newUser.id;
    const ov = e.votes && e.votes[oldUser.id];
    const nv = e.votes && e.votes[newUser.id];
    if (ov && !nv) {
      delete e.votes[oldUser.id];
      e.votes[newUser.id] = { ...ov, mergedFrom: oldUser.id };
    } else if (ov && nv) {
      const keepOld = (Number(ov.at) || 0) <= (Number(nv.at) || 0);
      if (!Array.isArray(e.mergedVotes)) e.mergedVotes = [];
      e.mergedVotes.push({ at: Date.now(), userId: newUser.id, fromUserId: oldUser.id, keptCandidate: (keepOld ? ov : nv).c || null, droppedCandidate: (keepOld ? nv : ov).c || null, reason: 'account replaced' });
      if (keepOld) e.votes[newUser.id] = { ...ov, mergedFrom: oldUser.id };
      delete e.votes[oldUser.id];
    }
    if (e.devices) for (const dk of Object.keys(e.devices)) if (e.devices[dk] && e.devices[dk].userId === oldUser.id) e.devices[dk].userId = newUser.id;
  }
  const remapList = (bag) => {
    if (!bag || typeof bag !== 'object') return;
    for (const k of Object.keys(bag)) {
      if (Array.isArray(bag[k])) bag[k] = [...new Set(bag[k].map((x) => (x === oldUser.id ? newUser.id : x)))];
      else if (bag[k] === oldUser.id) bag[k] = newUser.id;
    }
  };
  remapList(db.deviceOwner); remapList(db.fpOwner); remapList(db.deviceAccounts); remapList(db.fpAccounts);
  for (const [dk, ts] of Object.entries(oldUser.devices || {})) {
    if (!newUser.devices[dk] || Number(ts) > Number(newUser.devices[dk])) newUser.devices[dk] = ts;
    recordDeviceAccount(newUser, dk, null);
  }
  oldUser.accountStatus = 'replaced';
  oldUser.replacedBy = newUser.id;
  oldUser.replacedAt = Date.now();
  oldUser.tokens = {};
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
    let settled = false;
    const chunks = [];
    const fail = (message, statusCode) => {
      if (settled) return;
      settled = true;
      const err = new Error(message);
      err.statusCode = statusCode;
      reject(err);
    };
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        fail('Payload too large', 413);
        /* 413 response को flush होने का एक क्षण देकर connection बंद करो */
        const killer = setTimeout(() => { try { req.destroy(); } catch (_) {} }, 25);
        if (killer.unref) killer.unref();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { settled = true; return resolve({}); }
      try {
        const parsed = JSON.parse(raw);
        settled = true;
        /* सभी API body object ही मानते हैं — null/array/string आने पर
           handler में TypeError/500 की जगह सामान्य validation error मिले। */
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch (_) { fail('Invalid JSON', 400); }
    });
    req.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
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
  const token = clean(req && req.headers ? (req.headers['x-dev-token'] || '') : '', 80);
  /* 🔒 सिर्फ़ server का बनाया 56-hex token और devSessions की अपनी
     (own-property) entry ही मान्य है। Object.prototype से inherited
     key को कभी session न समझा जाए — यही इस audit की सबसे गंभीर fix है। */
  if (!/^[a-f0-9]{56}$/.test(token) || !db || !db.devSessions || typeof db.devSessions !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(db.devSessions, token)) return false;
  const s = db.devSessions[token];
  const exp = Number(s && s.expiresAt);
  if (!s || typeof s !== 'object' || !Number.isFinite(exp) || exp <= Date.now()) {
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
  /* ---------- 📩 शिकायत / ग्रीवांस (सार्वजनिक, बिना लॉगिन) ----------
     IT Rules 2021 Rule 3(2): हर शिकायत 24 घंटे में स्वीकार, 15 दिन में हल। */
  if (method === 'POST' && parts[1] === 'complaints' && parts.length === 2) {
    if (!rateLimit(req, 'complaint', 6, 10 * 60 * 1000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा शिकायतें भेजी गईं — कुछ मिनट बाद कोशिश करें' });
    }
    let body = null;
    try { body = await readBody(req); } catch (_) { body = null; }
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'शिकायत खाली है' });

    const KINDS = ['content', 'privacy', 'technical', 'other'];
    const kind = KINDS.includes(String(body.kind || '')) ? String(body.kind) : 'other';
    const message = String(body.message || '').trim().slice(0, 1000);
    if (message.length < 5) return sendJson(res, 400, { error: 'शिकायत कम से कम 5 अक्षर लिखें' });

    const code = String(body.electionCode || '').trim().toUpperCase().slice(0, 10);
    const election = code ? findElection(code) : null;

    const item = {
      id: rid(4).toUpperCase(),
      at: Date.now(),
      kind,
      message,
      name: String(body.name || '').trim().slice(0, 60),
      contact: String(body.contact || '').trim().slice(0, 80),
      electionCode: election ? election.code : null,
      electionTitle: election ? election.title : null,
      status: 'open',
      resolvedAt: null,
      note: '',
    };
    db.complaints.push(item);
    await saveNow();
    console.log('📩 new complaint', item.id, kind);
    return sendJson(res, 201, {
      ok: true,
      id: item.id,
      at: item.at,
      sla: { ackHours: 24, resolveDays: 15, takedownHours: 36 },
    });
  }

  /* ---------- username खाली है या नहीं (सिर्फ़ जाँच, खाता नहीं बनता) ---------- */
  if ((method === 'GET' || method === 'POST') && parts[1] === 'auth' && parts[2] === 'username-available') {
    if (!rateLimit(req, 'uname-check', 60, 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा जाँचें। थोड़ा रुककर फिर देखें।' });
    }
    let raw = url.searchParams.get('u') || '';
    if (method === 'POST') { const b = await readBody(req); raw = b.username || raw; }
    const uv = validateUsername(raw);
    if (uv.error) return sendJson(res, 200, { available: false, valid: false, error: uv.error, username: normalizeUsername(raw) });
    const taken = usernameTaken(uv.username, viewer ? viewer.id : null);
    return sendJson(res, 200, {
      available: !taken,
      valid: true,
      username: uv.username,
      error: taken ? 'यह username पहले से उपयोग में है — कोई दूसरा चुनें।' : null,
      suggestions: taken ? usernameSuggestions(uv.username) : [],
    });
  }

  /* ---------- नया खाता: असली नाम + unique username + 6–10 अंकों का PIN ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'register') {
    if (!rateLimit(req, 'register', 15, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा कोशिशें। कुछ मिनट बाद फिर प्रयास करें।' });
    }
    const body = await readBody(req);
    const nv = validateName(body.name);
    if (nv.error) return sendJson(res, 400, { error: nv.error });
    const uv = validateUsername(body.username);
    if (uv.error) return sendJson(res, 400, { error: uv.error });
    const pv = validatePin(body.password, uv.username);
    if (pv.error) return sendJson(res, 400, { error: pv.error });
    if (usernameTaken(uv.username)) {
      return sendJson(res, 409, { error: 'यह username (@' + uv.username + ') पहले से उपयोग में है — कोई दूसरा चुनें।', code: 'USERNAME_TAKEN', suggestions: usernameSuggestions(uv.username) });
    }

    const device = deviceKeyFrom(req, body.deviceId);
    const fp = fpKeyFrom(req);
    const sameName = orderedCandidates(findUsersByName(nv.name), device, fp);

    /* पुराना बिना-PIN खाता + यही उसका अपना फ़ोन -> उसी खाते पर username+PIN लगा दो (नया खाता नहीं) */
    const legacy = claimableLegacy(sameName, device, fp);
    if (legacy) {
      const recoveryCode = setPasswordAndRecovery(legacy, pv.password);
      legacy.name = nv.name;
      legacy.username = uv.username;
      legacy.accountStatus = 'active';
      return completeAuth(req, res, legacy, body, { claimed: true, recoveryCode }, 200);
    }

    /* 🔒 एक फ़ोन = एक खाता: इस फ़ोन पर पहले से कोई खाता है तो सीधा दूसरा signup नहीं —
       परिवार के दूसरे सदस्य के लिए appeal वाला रास्ता है (डेवलपर मंज़ूरी देगा)। */
    const conflicts = deviceConflictUsers(device, fp).filter((u) => u.username || u.pwHash);
    if (conflicts.length) {
      return sendJson(res, 409, {
        error: 'इस फ़ोन पर पहले से एक खाता बना हुआ है, इसलिए दूसरा खाता सीधे नहीं बनेगा। अगर आप परिवार के दूसरे सदस्य हैं तो नीचे "Username भूल गए / दूसरा खाता चाहिए" से appeal भेजें — Team Janmat जाँचकर मंज़ूरी देगी।',
        code: 'DEVICE_HAS_ACCOUNT',
      });
    }

    const user = {
      id: rid(8),
      name: nv.name,
      nameLower: nameKey(nv.name),
      username: uv.username,
      accountStatus: 'active',
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      isDemo: false,
      devices: {},
      tokens: {},
    };
    const recoveryCode = setPasswordAndRecovery(user, pv.password);
    db.users.push(user);
    return completeAuth(req, res, user, body, {
      isNewAccount: true,
      recoveryCode,
      sameNameExists: sameName.length > 0,
    }, 201);
  }

  /* ---------- पुराना खाता (v7.x) में username जोड़ना ----------
     पुराना नाम + पुराना पासवर्ड साबित करो, फिर नया username + नया PIN लगाओ।
     बिल्कुल पुराने बिना-पासवर्ड खाते सिर्फ़ अपने बँधे फ़ोन से claim होंगे। */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'migrate') {
    if (!rateLimit(req, 'migrate', 10, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा कोशिशें। कुछ मिनट बाद फिर प्रयास करें।' });
    }
    const body = await readBody(req);
    const nv = validateName(body.name);
    if (nv.error) return sendJson(res, 400, { error: nv.error });
    const uv = validateUsername(body.username);
    if (uv.error) return sendJson(res, 400, { error: uv.error });
    const pv = validatePin(body.password, uv.username);
    if (pv.error) return sendJson(res, 400, { error: pv.error });
    if (usernameTaken(uv.username)) {
      return sendJson(res, 409, { error: 'यह username (@' + uv.username + ') पहले से उपयोग में है — कोई दूसरा चुनें।', code: 'USERNAME_TAKEN', suggestions: usernameSuggestions(uv.username) });
    }
    const device = deviceKeyFrom(req, body.deviceId);
    const fp = fpKeyFrom(req);
    const candidates = orderedCandidates(findUsersByName(nv.name), device, fp).filter((u) => !u.username);
    const oldPassword = String(body.oldPassword == null ? '' : body.oldPassword);
    let target = oldPassword ? findPasswordMatch(candidates, oldPassword) : null;
    if (!target) target = claimableLegacy(candidates, device, fp);
    if (!target) {
      return sendJson(res, 401, { error: 'पुराना खाता साबित नहीं हो सका। पुराना नाम और पुराना पासवर्ड ठीक से लिखें — या उसी पुराने फ़ोन से कोशिश करें जिससे खाता बना था।', code: 'MIGRATION_FAILED' });
    }
    const recoveryCode = setPasswordAndRecovery(target, pv.password);
    target.name = nv.name;
    target.username = uv.username;
    target.accountStatus = 'active';
    target.tokens = {};
    return completeAuth(req, res, target, body, { claimed: true, migrated: true, recoveryCode }, 200);
  }

  /* ---------- लॉगिन किया हुआ पुराना उपयोगकर्ता username चुने (सत्र पहले से है) ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'set-username') {
    if (!viewer) return sendJson(res, 401, { error: 'लॉगिन नहीं है।', code: 'LOGIN_REQUIRED' });
    if (viewer.username) return sendJson(res, 409, { error: 'आपके खाते पर username (@' + viewer.username + ') पहले से लगा है — username हमेशा के लिए वही रहता है।', code: 'USERNAME_ALREADY_SET' });
    const body = await readBody(req);
    const uv = validateUsername(body.username);
    if (uv.error) return sendJson(res, 400, { error: uv.error });
    if (usernameTaken(uv.username, viewer.id)) {
      return sendJson(res, 409, { error: 'यह username (@' + uv.username + ') पहले से उपयोग में है — कोई दूसरा चुनें।', code: 'USERNAME_TAKEN', suggestions: usernameSuggestions(uv.username) });
    }
    viewer.username = uv.username;
    viewer.accountStatus = 'active';
    await saveNow();
    return sendJson(res, 200, { ok: true, user: publicUser(viewer), quota: quotaFor(viewer) });
  }

  /* ---------- लॉगिन: username + PIN ज़रूरी (नाम से लॉगिन अब बिल्कुल बंद) ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'login') {
    if (!rateLimit(req, 'login', 20, 60000)) {
      return sendJson(res, 429, { error: 'कारण: बहुत ज़्यादा लॉगिन कोशिशें हुई हैं — एक मिनट रुककर प्रयास करें।', code: 'RATE_LIMITED' });
    }
    const body = await readBody(req);
    const uv = validateUsername(body.username);
    if (uv.error) {
      return sendJson(res, 400, { error: 'अपना सही username लिखें (जैसे pawan_verma) — लॉगिन अब नाम से नहीं, username से होता है।', code: 'USERNAME_REQUIRED' });
    }
    if (!globalRateLimit('login-user:' + sha256(uv.username).slice(0, 16), 30, 10 * 60000)) {
      return sendJson(res, 429, { error: 'कारण: इस username पर बहुत ज़्यादा गलत कोशिशें हुई हैं — सुरक्षा के लिए 10 मिनट बाद प्रयास करें।', code: 'RATE_LIMITED' });
    }
    const password = String(body.password == null ? '' : body.password);
    if (!password) {
      return sendJson(res, 400, { error: 'अपना PIN लिखें।', code: 'PASSWORD_REQUIRED' });
    }
    const user = findUserByUsername(uv.username);
    if (!user) {
      syncApplications();
      const pending = db.accountApplications.find((a) => a && a.status === 'pending' && a.desiredUsername === uv.username);
      if (pending) {
        return sendJson(res, 401, { error: 'यह खाता अभी Team Janmat की जाँच में है (Pending)। मंज़ूरी मिलते ही इसी username + PIN से लॉगिन होगा।', code: 'ACCOUNT_PENDING' });
      }
      return sendJson(res, 401, { error: 'इस username का कोई खाता नहीं मिला। Username ध्यान से देखें — या "नया खाता बनाएँ" चुनें।', code: 'ACCOUNT_NOT_FOUND' });
    }
    if (!isActiveUser(user)) {
      return sendJson(res, 401, { error: 'यह खाता अब चालू नहीं है। अगर आपका खाता नए username से जुड़ा था तो उससे लॉगिन करें।', code: 'ACCOUNT_INACTIVE' });
    }
    if (!user.pwHash || !verifySecret(password, user.pwHash)) {
      return sendJson(res, 401, { error: 'PIN सही नहीं है। ध्यान से दोबारा लिखें — या "PIN भूल गए" से रिकवरी कोड इस्तेमाल करें।', code: 'WRONG_PASSWORD' });
    }
    return completeAuth(req, res, user, body, {}, 200);
  }

  /* ---------- PIN भूल गए: username + लॉगिन-कार्ड वाला गुप्त रिकवरी कोड ----------
     v8.2.3: (1) हर गलती का कारण अलग-अलग बताया जाता है, ताकि उपयोगकर्ता को पता चले
     कि रुकावट कहाँ है। (2) सफल recovery पर कोड अब बदला (rotate) नहीं जाता — वही
     कार्ड हमेशा चलेगा; नया कार्ड संभालने का भ्रम ख़त्म। नया कोड उपयोगकर्ता खुद
     Settings से जब चाहे बना सकता है (/api/auth/recovery-code)। */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'recover') {
    if (!rateLimit(req, 'recover', 5, 10 * 60000) || !globalRateLimit('recover', 30, 10 * 60000)) {
      return sendJson(res, 429, { error: 'कारण: बहुत ज़्यादा कोशिशें हो चुकी हैं — सुरक्षा के लिए रिकवरी कुछ देर रुकी है। 10 मिनट रुककर एक बार ध्यान से प्रयास करें, बार-बार न दबाएँ।', code: 'RATE_LIMITED' });
    }
    const body = await readBody(req);
    const uv = validateUsername(body.username);
    if (uv.error) return sendJson(res, 400, { error: 'कारण: username ठीक से नहीं लिखा गया। अपना सही username लिखें (जैसे pawan_verma)।', code: 'USERNAME_INVALID' });
    const pv = validatePin(body.newPassword, uv.username);
    if (pv.error) return sendJson(res, 400, { error: 'नया PIN नहीं बन पाया — ' + pv.error, code: 'PIN_INVALID' });
    const user = findUserByUsername(uv.username);
    if (!user) {
      return sendJson(res, 401, { error: 'कारण: इस username (@' + uv.username + ') का कोई खाता ही नहीं मिला। username की spelling ध्यान से देखें — लॉगिन कार्ड पर लिखा username बिल्कुल वैसा ही लिखें।', code: 'ACCOUNT_NOT_FOUND' });
    }
    if (!isActiveUser(user)) {
      return sendJson(res, 401, { error: 'कारण: यह खाता अब चालू नहीं है (शायद नए खाते से बदल चुका है)। अपने नए username से प्रयास करें।', code: 'ACCOUNT_INACTIVE' });
    }
    const code = normalizeRecovery(body.recoveryCode);
    if (code.length !== 12) {
      return sendJson(res, 400, { error: 'कारण: रिकवरी कोड अधूरा लिखा है। कोड कुल 12 अक्षरों का होता है (जैसे ABCD-EFGH-JKLM) — आपने ' + code.length + ' अक्षर लिखे हैं। कार्ड देखकर पूरा कोड लिखें।', code: 'RECOVERY_CODE_FORMAT' });
    }
    if (!user.recoveryHash) {
      return sendJson(res, 401, { error: 'कारण: इस (पुराने) खाते पर रिकवरी कोड सेट ही नहीं है। नीचे "खाता वापसी आवेदन" भेजें — Team Janmat जाँचकर आपके उसी खाते पर नया PIN लगा देगी।', code: 'RECOVERY_NOT_SET' });
    }
    if (!verifySecret(code, user.recoveryHash)) {
      return sendJson(res, 401, { error: 'कारण: यह रिकवरी कोड इस खाते के मौजूदा कोड से मेल नहीं खाता। एक भी अक्षर गलत हो तो कोड नहीं चलेगा (कोड में O, I, 0, 1 होते ही नहीं)। अगर आपको पहले कभी नया कार्ड मिला था या आपने Settings से नया कोड बनाया था, तो वही सबसे नया कोड लगेगा — पुराना कार्ड नहीं चलेगा। कार्ड ही खो गया हो तो नीचे "खाता वापसी आवेदन" भेजें।', code: 'RECOVERY_CODE_WRONG' });
    }
    user.pwHash = hashSecret(pv.password);
    user.pwSetAt = Date.now();
    user.tokens = {};   /* बाकी सब जगह से लॉगआउट — रिकवरी कोड वही रहता है */
    return completeAuth(req, res, user, body, { recovered: true, recoveryCodeKept: true }, 200);
  }

  /* ---------- नया रिकवरी कोड बनाएँ (लॉगिन किया हुआ उपयोगकर्ता, मौजूदा PIN से) ----------
     कार्ड खो जाए पर PIN याद हो, तो उपयोगकर्ता खुद नया कोड बना सकता है।
     नया कोड बनते ही पुराना कोड/कार्ड बंद हो जाता है। */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'recovery-code') {
    if (!viewer) return sendJson(res, 401, { error: 'कारण: लॉगिन नहीं है। नया रिकवरी कोड सिर्फ़ अपने खाते में लॉगिन के बाद बनता है।', code: 'LOGIN_REQUIRED' });
    if (!rateLimit(req, 'recgen', 5, 10 * 60000)) {
      return sendJson(res, 429, { error: 'कारण: बहुत ज़्यादा कोशिशें। कुछ मिनट बाद प्रयास करें।', code: 'RATE_LIMITED' });
    }
    const body = await readBody(req);
    if (!viewer.pwHash) {
      return sendJson(res, 400, { error: 'कारण: इस खाते पर PIN सेट ही नहीं है — पहले PIN बनाएँ, तभी रिकवरी कोड बनेगा।', code: 'PIN_NOT_SET' });
    }
    if (!verifySecret(String(body.currentPassword || ''), viewer.pwHash)) {
      return sendJson(res, 401, { error: 'कारण: मौजूदा PIN सही नहीं है, इसलिए नया कोड नहीं बना। ध्यान से दोबारा लिखें।', code: 'WRONG_PASSWORD' });
    }
    const code = makeRecoveryCode();
    viewer.recoveryHash = hashSecret(normalizeRecovery(code));
    viewer.recoverySetAt = Date.now();
    await saveNow();
    return sendJson(res, 200, { ok: true, recoveryCode: code, user: publicUser(viewer), message: 'नया रिकवरी कोड बन गया। पुराना कोड अब नहीं चलेगा — नया कार्ड/कोड सँभाल लें।' });
  }

  /* ---------- username का संकेत: इसी फ़ोन से जुड़े खाते का छिपा हुआ username ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'username-hint') {
    if (!rateLimit(req, 'uname-hint', 10, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा कोशिशें। कुछ मिनट बाद प्रयास करें।' });
    }
    const body = await readBody(req);
    const device = deviceKeyFrom(req, body.deviceId);
    const fp = fpKeyFrom(req);
    const users = deviceConflictUsers(device, fp).filter((u) => u.username);
    if (!users.length) {
      return sendJson(res, 200, { ok: false, hint: null, message: 'इस फ़ोन से कोई खाता जुड़ा नहीं मिला। लॉगिन कार्ड देखें या नीचे appeal भेजें।' });
    }
    const ordered = orderedCandidates(users, device, fp);
    return sendJson(res, 200, {
      ok: true,
      count: ordered.length,
      hints: ordered.slice(0, 3).map((u) => ({ usernameMasked: '@' + maskUsername(u.username), name: u.name })),
      message: 'क्या इनमें से कोई आपका username है? पूरा username लॉगिन कार्ड पर लिखा होता है।',
    });
  }

  /* ---------- Appeal: username भूल गए / साझा फ़ोन पर दूसरा खाता ----------
     खाता तुरंत नहीं बनता — आवेदन Pending रहेगा, डेवलपर (Team Janmat) जाँचकर
     डेवलपर पैनल से मंज़ूरी देगा। चुना username तब तक reserved रहता है। */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'apply') {
    if (!rateLimit(req, 'apply', 5, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा आवेदन। कुछ मिनट बाद प्रयास करें।' });
    }
    const body = await readBody(req);
    const kind = body.kind === 'device-second-account' ? 'device-second-account'
      : body.kind === 'lost-pin-recovery' ? 'lost-pin-recovery'
      : 'forgot-username';
    const nv = validateName(body.name);
    if (nv.error) return sendJson(res, 400, { error: nv.error });
    const uv = validateUsername(body.username);
    if (uv.error) return sendJson(res, 400, { error: uv.error });
    const pv = validatePin(body.password, uv.username);
    if (pv.error) return sendJson(res, 400, { error: pv.error });
    const reason = clean(body.reason, 300);
    if (reason.length < 8) return sendJson(res, 400, { error: 'कारण थोड़ा साफ़ लिखें (कम से कम 8 अक्षर) — जैसे "पुराना username भूल गया, फ़ोन यही है"।' });
    /* खाता-वापसी (PIN भी भूला + कार्ड भी खोया): username मौजूद खाते का ही होगा।
       मंज़ूरी सिर्फ़ डेवलपर देगा; बिना मंज़ूरी खाते पर कुछ नहीं बदलता। */
    let lostTarget = null;
    if (kind === 'lost-pin-recovery') {
      lostTarget = findUserByUsername(uv.username);
      if (!lostTarget || !isActiveUser(lostTarget)) {
        return sendJson(res, 404, { error: 'कारण: इस username (@' + uv.username + ') का कोई चालू खाता नहीं मिला। वही username लिखें जो आपके खाते पर था — spelling ध्यान से देखें।', code: 'ACCOUNT_NOT_FOUND' });
      }
    } else if (usernameTaken(uv.username)) {
      return sendJson(res, 409, { error: 'यह username (@' + uv.username + ') पहले से उपयोग/जाँच में है — कोई दूसरा चुनें।', code: 'USERNAME_TAKEN', suggestions: usernameSuggestions(uv.username) });
    }
    const device = deviceKeyFrom(req, body.deviceId);
    const fp = fpKeyFrom(req);
    syncApplications();
    const duplicate = db.accountApplications.find((a) => a && a.status === 'pending' && a.device === device && a.desiredUsername === uv.username);
    if (duplicate) {
      return sendJson(res, 409, { error: 'इसी username का आपका आवेदन पहले से जाँच में है। आवेदन नंबर: ' + duplicate.id, code: 'APPLICATION_PENDING', applicationId: duplicate.id });
    }
    if (kind === 'lost-pin-recovery') {
      const dupLost = db.accountApplications.find((a) => a && a.status === 'pending' && a.kind === 'lost-pin-recovery' && a.desiredUsername === uv.username);
      if (dupLost) {
        return sendJson(res, 409, { error: 'कारण: इस खाते (@' + uv.username + ') की वापसी का आवेदन पहले से जाँच में है। आवेदन नंबर: ' + dupLost.id + ' — स्थिति नीचे देख सकते हैं।', code: 'APPLICATION_PENDING', applicationId: dupLost.id });
      }
    }
    const conflicts = deviceConflictUsers(device, fp).map((u) => u.id);
    if (lostTarget && !conflicts.includes(lostTarget.id)) conflicts.push(lostTarget.id);
    const receipt = rid(14);
    const recoveryCode = makeRecoveryCode();
    const app = {
      id: 'APP-' + rid(4).toUpperCase(),
      kind,
      name: nv.name,
      desiredUsername: uv.username,
      pwHash: hashSecret(pv.password),
      recoveryHash: hashSecret(normalizeRecovery(recoveryCode)),
      receiptHash: sha256(receipt),
      reason,
      device,
      fp: fp || null,
      conflictUserIds: conflicts,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 864e5,
      decidedAt: null,
      decisionNote: '',
      resultingUserId: null,
      replacedUserId: null,
      targetUserId: lostTarget ? lostTarget.id : null,   /* सिर्फ़ खाता-वापसी आवेदन पर */
    };
    db.accountApplications.push(app);
    await saveNow();
    broadcastDev('account-application', { at: app.createdAt, id: app.id, kind: app.kind, name: app.name, username: app.desiredUsername });
    return sendJson(res, 201, {
      ok: true,
      applicationId: app.id,
      receipt,
      recoveryCode,
      status: 'pending',
      message: kind === 'lost-pin-recovery'
        ? 'आपका खाता-वापसी आवेदन Team Janmat के पास जाँच में है। मंज़ूरी मिलते ही आपके पुराने खाते (@' + uv.username + ') पर यही चुना हुआ नया PIN लग जाएगा और नीचे वाला नया रिकवरी कोड चालू होगा। आवेदन नंबर और कोड सँभालकर रखें।'
        : 'आपका आवेदन Team Janmat के पास जाँच में है। मंज़ूरी मिलने पर इसी username + PIN से लॉगिन होगा। रिकवरी कोड और आवेदन नंबर सँभालकर रखें।',
    });
  }

  /* ---------- Appeal की स्थिति (receipt या उसी फ़ोन से) ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'application-status') {
    const body = await readBody(req);
    syncApplications();
    const device = deviceKeyFrom(req, body.deviceId);
    let app = null;
    const appId = clean(body.applicationId, 24).toUpperCase();
    if (appId) app = db.accountApplications.find((a) => a && a.id === appId) || null;
    if (!app && device) {
      const mine = db.accountApplications.filter((a) => a && a.device === device).sort((a, b) => b.createdAt - a.createdAt);
      app = mine[0] || null;
    }
    if (!app) return sendJson(res, 404, { error: 'इस फ़ोन पर कोई आवेदन नहीं मिला। आवेदन नंबर ठीक से लिखें।' });
    const receipt = clean(body.receipt, 60);
    const receiptOk = receipt && app.receiptHash === sha256(receipt);
    if (!receiptOk && app.device !== device) {
      return sendJson(res, 403, { error: 'यह आवेदन इस फ़ोन/रसीद से नहीं खुल सकता।' });
    }
    return sendJson(res, 200, {
      ok: true,
      applicationId: app.id,
      status: app.status,
      kind: app.kind,
      username: app.desiredUsername,
      name: app.name,
      createdAt: app.createdAt,
      decidedAt: app.decidedAt || null,
      decisionNote: app.decisionNote || '',
      message: app.status === 'approved'
        ? (app.kind === 'lost-pin-recovery'
          ? 'बधाई हो! आपके पुराने खाते (@' + app.desiredUsername + ') पर आवेदन वाला नया PIN लग गया है — उसी PIN से लॉगिन करें। लॉगिन के बाद Settings से नया रिकवरी कार्ड भी बना लें।'
          : 'बधाई हो! आपका खाता बन गया है — अब अपने username + PIN से लॉगिन करें।')
        : app.status === 'rejected'
          ? 'क्षमा करें, यह आवेदन मंज़ूर नहीं हुआ। कारण ऊपर दिया है।'
          : app.status === 'expired'
            ? 'यह आवेदन 7 दिन पूरे होने पर समाप्त हो गया — चाहें तो फिर से आवेदन भेजें।'
            : 'आपका आवेदन Team Janmat की जाँच में है। मंज़ूरी मिलते ही यहीं पता चल जाएगा।',
    });
  }

  /* ---------- PIN बदलना (लॉगिन किया हुआ उपयोगकर्ता) ---------- */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'password') {
    if (!viewer) return sendJson(res, 401, { error: 'लॉगिन नहीं है।', code: 'LOGIN_REQUIRED' });
    if (!rateLimit(req, 'pwchange', 10, 10 * 60000)) {
      return sendJson(res, 429, { error: 'बहुत ज़्यादा कोशिशें। कुछ मिनट बाद प्रयास करें।' });
    }
    const body = await readBody(req);
    if (!viewer.pwHash || !verifySecret(String(body.oldPassword || ''), viewer.pwHash)) {
      return sendJson(res, 401, { error: 'मौजूदा PIN सही नहीं है।', code: 'WRONG_PASSWORD' });
    }
    const pv = validatePin(body.newPassword, viewer.username);
    if (pv.error) return sendJson(res, 400, { error: pv.error });
    viewer.pwHash = hashSecret(pv.password);
    viewer.pwSetAt = Date.now();
    /* इस सत्र को छोड़कर बाकी सब सत्र बंद */
    const cur = sha256(clean(req.headers['x-user-token'] || '', 80));
    const curRec = viewer.tokens && viewer.tokens[cur];
    viewer.tokens = curRec ? { [cur]: curRec } : {};
    await saveNow();
    return sendJson(res, 200, { ok: true, message: 'PIN बदल गया।' });
  }

  /* =====================================================================
     🔐 डिवाइस संकेत (सिर्फ़ नाम का सुझाव — बिना पासवर्ड token अब कभी नहीं)
     पहले device पहचानते ही खाता खुल जाता था; पासवर्ड व्यवस्था में वह
     पिछले दरवाज़े जैसा होता, इसलिए अब सिर्फ़ "इस फ़ोन पर कौन-सा नाम
     चला था" बताया जाता है ताकि लॉगिन पेज पर नाम भरने में आसानी हो।
     असली सत्र हमेशा सहेजे हुए token (या पासवर्ड लॉगिन) से ही चलता है।
     ===================================================================== */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'auto') {
    const body = await readBody(req);
    const device = deviceKeyFrom(req, body.deviceId);
    const fp = fpKeyFrom(req);
    if (!db.deviceOwner) db.deviceOwner = {};
    if (!db.fpOwner) db.fpOwner = {};
    const ownerId = db.deviceOwner[device] || (fp ? db.fpOwner[fp] : null);
    const owner = ownerId ? db.users.find((u) => u.id === ownerId) : null;
    if (!owner || owner.deletedAt) {
      return sendJson(res, 200, { ok: false, hint: null, passwordRequired: true });
    }
    return sendJson(res, 200, {
      ok: false,
      hint: { name: owner.name, usernameMasked: owner.username ? '@' + maskUsername(owner.username) : null, via: db.deviceOwner[device] ? 'device' : 'fingerprint' },
      passwordRequired: true,
      message: 'इस फ़ोन से पहले "' + owner.name + '" का खाता चला था। लॉगिन के लिए अपना username + PIN लिखें।',
    });
  }

  /* ---------- पुराना name-device rebind अब बंद ----------
     Username-व्यवस्था में फ़ोन को नाम से "छुड़ाने" की ज़रूरत नहीं है: कोई भी
     अपने username + PIN से किसी भी फ़ोन पर लॉगिन कर सकता है। इस रास्ते को
     खुला रखना "एक फ़ोन = एक खाता" नियम कमज़ोर कर सकता था। */
  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'rebind') {
    return sendJson(res, 410, { error: 'अब लॉगिन username + PIN से होता है — फ़ोन से नाम छुड़ाने की ज़रूरत नहीं। अपने username से लॉगिन करें।', code: 'REBIND_RETIRED' });
  }

  if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'logout') {
    const token = clean(req.headers['x-user-token'] || '', 80);
    if (viewer && token && viewer.tokens) {
      delete viewer.tokens[sha256(token)];
      delete viewer.tokens[token];   /* पुरानी शैली का बचा-खुचा सत्र भी साफ़ */
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
      return sendJson(res, 401, { error: 'चुनाव बनाने के लिए पहले username से लॉगिन करें।', code: 'LOGIN_REQUIRED' });
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

    /* body पढ़ने के दौरान समानांतर अनुरोध आ सकते हैं — DB में जोड़ने से
       ठीक पहले कोटा फिर जाँचो, वरना धीमी/आधी body वाले कई अनुरोध एक साथ
       शुरुआती जाँच पार करके रोज़ की सीमा से ज़्यादा चुनाव बना सकते थे। */
    const qNow = quotaFor(viewer);
    if (qNow.remaining <= 0) {
      return sendJson(res, 403, {
        error: `आप आज की सीमा (${qNow.limit} चुनाव प्रतिदिन) पूरी कर चुके हैं। अगला चुनाव ${new Date(qNow.resetsAt).toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata' })} के बाद बना सकते हैं।`,
        code: 'DAILY_LIMIT',
        quota: qNow,
      });
    }
    viewer.electionDay = istDayKey();
    viewer.electionDayCount = qNow.used + 1;

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
    /* body आने में देर हुई हो और उसी बीच समय पूरा हो गया हो तो वोट न लो */
    syncElection(election);
    if (election.closed) {
      return sendJson(res, 403, { error: 'यह चुनाव समाप्त हो चुका है, अब वोट नहीं डाला जा सकता।' });
    }
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
       — पहले रोकते हैं और साफ़ संदेश देते हैं। "मैं दूसरा व्यक्ति हूँ" वाला override
       सिर्फ़ लॉगिन किए हुए खाते को मिलता है (साझा फ़ोन का स्वीकृत दूसरा सदस्य /
       एक ही मॉडल के दूसरे फ़ोन वाला असली व्यक्ति) — Guest को कभी नहीं, वरना हर
       नए इनकॉग्निटो tab से वही बटन दबाकर असीमित फ़र्जी़ वोट डाले जा सकते थे।
       खाते वाला override वोट भी डेवलपर को अलग से (flag के साथ) दिखता है। */
    const fpNow = fpKeyFrom(req);
    const fpAlready = !!(fpNow && election.fpVotes && election.fpVotes[fpNow] && election.fpVotes[fpNow].length);
    const overrideOk = fpAlready && body.overrideSamePhone === true && !!viewer;
    if (fpAlready && !overrideOk) {
      return sendJson(res, 409, {
        error: viewer
          ? 'इस फ़ोन से इस चुनाव में पहले ही वोट दिया जा चुका है। एक फ़ोन से एक ही वोट मान्य है।'
          : 'इस फ़ोन से इस चुनाव में पहले ही वोट दिया जा चुका है। बिना खाते के (Guest) इस फ़ोन से दोबारा वोट नहीं हो सकता। अगर आप परिवार के दूसरे सदस्य हैं, तो पहले अपने खाते से लॉगिन करें (नया खाता Developer की मंज़ूरी से बनता है) — फिर वोट कर पाएँगे।',
        code: 'SAME_PHONE_VOTED',
        allowOverride: !!viewer,
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
    if (Object.prototype.hasOwnProperty.call(db.devSessions, token)) {
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
    if (!devTokenValid({ headers: { 'x-dev-token': t } })) {
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
          username: u.username || null,
          accountStatus: u.accountStatus || 'active',
          hasPassword: !!u.pwHash,
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
          creatorUsername: creator ? (creator.username || null) : null,
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
          userUsername: u ? (u.username || null) : null,
          linkedName: (v && v.linkedName) || null,
          linkedUsername: (v && v.linkedUsername) || (u && v && v.sourceGuest ? (u.username || null) : null),
          voteSource: (v && v.sourceGuest) ? 'guest-first' : (String(uid).startsWith('g:') ? 'guest' : 'account'),
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

    /* 📊 उपयोग मीटर — असली Redis command गिनती (इस अपडेट के बाद से) */
    const monthKey = istMonthKey();
    const usage = {
      monthKey,
      commands: (db.meta && db.meta.month === monthKey) ? (Number(db.meta.cmds) || 0) : 0,
      commandQuota: 500000,
      votesThisMonth: voteRows.filter((v) => istMonthKey(v.at) === monthKey).length,
      electionsThisMonth: db.elections.filter((e) => istMonthKey(e.createdAt) === monthKey).length,
      dbBytes: Buffer.byteLength(JSON.stringify(db), 'utf8'),
      dbBytesQuota: 250 * 1024 * 1024,
      openComplaints: db.complaints.filter((c) => c.status === 'open').length,
      pendingApplications: (db.accountApplications || []).filter((a) => a && a.status === 'pending').length,
      accountsWithoutUsername: db.users.filter((u) => u && !u.username && !u.isDemo && (u.accountStatus || 'active') === 'active').length,
    };

    return sendJson(res, 200, { stats, usage, users, elections, votes: voteRows.slice(0, 1000) });
  }

  /* ---------- developer: शिकायतें (grievance dashboard) ---------- */
  if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'complaints' && parts.length === 3) {
    const list = [...db.complaints].sort((a, b) => b.at - a.at);
    const open = list.filter((c) => c.status === 'open');
    return sendJson(res, 200, {
      complaints: list,
      stats: {
        total: list.length,
        open: open.length,
        resolved: list.length - open.length,
        oldestOpenAt: open.length ? Math.min(...open.map((c) => c.at)) : null,
      },
    });
  }

  /* ---------- developer: शिकायत हटाओ (स्पैम/टेस्ट साफ़ करने के लिए) ---------- */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'complaints' && parts[3] && parts[4] === 'delete') {
    const idx = db.complaints.findIndex((c) => c.id === String(parts[3]).toUpperCase());
    if (idx === -1) return sendJson(res, 404, { error: 'शिकायत नहीं मिली' });
    const [removed] = db.complaints.splice(idx, 1);
    await saveNow();
    return sendJson(res, 200, { ok: true, deleted: removed.id });
  }

  /* ---------- developer: शिकायत हल हुई ---------- */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'complaints' && parts[3] && parts[4] === 'resolve') {
    const item = db.complaints.find((c) => c.id === String(parts[3]).toUpperCase());
    if (!item) return sendJson(res, 404, { error: 'शिकायत नहीं मिली' });
    let body = null;
    try { body = await readBody(req); } catch (_) { body = null; }
    item.status = 'resolved';
    item.resolvedAt = Date.now();
    item.note = String((body && body.note) || '').trim().slice(0, 300);
    await saveNow();
    return sendJson(res, 200, { ok: true, complaint: item });
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
          userUsername: u ? (u.username || null) : null,
          userIsDemo: u ? !!u.isDemo : false,
          linkedName: (v && v.linkedName) || null,
          linkedUsername: (v && v.linkedUsername) || (u && v && v.sourceGuest ? (u.username || null) : null),
          voteSource: (v && v.sourceGuest) ? 'guest-first' : (String(uid).startsWith('g:') ? 'guest' : 'account'),
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
        creatorUsername: creator ? (creator.username || null) : null,
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

  /* ---------- developer: खाता आवेदन (appeals) सूची ----------
     कोई गुप्त जानकारी (PIN/code hash) कभी नहीं भेजी जाती। */
  if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'applications' && parts.length === 3) {
    syncApplications();
    const rank = { pending: 0, approved: 1, rejected: 2, expired: 3 };
    const applications = [...db.accountApplications]
      .sort((a, b) => ((rank[a.status] ?? 9) - (rank[b.status] ?? 9)) || (b.createdAt - a.createdAt))
      .slice(0, 300)
      .map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        desiredUsername: a.desiredUsername,
        reason: a.reason,
        status: a.status,
        createdAt: a.createdAt,
        expiresAt: a.expiresAt || null,
        decidedAt: a.decidedAt || null,
        decisionNote: a.decisionNote || '',
        resultingUserId: a.resultingUserId || null,
        replacedUserId: a.replacedUserId || null,
        conflicts: (a.conflictUserIds || []).map((id) => findUserById(id)).filter(Boolean).map((u) => ({
          id: u.id, name: u.name, username: u.username || null, accountStatus: u.accountStatus || 'active',
          hasPassword: !!u.pwHash, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
          electionsCreated: db.elections.filter((e) => e.creatorId === u.id).length,
          votesCast: db.elections.filter((e) => e.votes && e.votes[u.id]).length,
        })),
      }));
    return sendJson(res, 200, {
      applications,
      stats: {
        total: applications.length,
        pending: applications.filter((a) => a.status === 'pending').length,
        approved: applications.filter((a) => a.status === 'approved').length,
        rejected: applications.filter((a) => a.status === 'rejected').length,
      },
    });
  }

  /* ---------- developer: आवेदन मंज़ूर/अस्वीकार ---------- */
  if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'applications' && parts[3] && (parts[4] === 'approve' || parts[4] === 'reject')) {
    syncApplications();
    const app = db.accountApplications.find((a) => a && a.id === String(parts[3]).toUpperCase());
    if (!app) return sendJson(res, 404, { error: 'आवेदन नहीं मिला।' });
    if (app.status !== 'pending') {
      return sendJson(res, 409, { error: 'इस आवेदन पर पहले ही निर्णय हो चुका है (' + app.status + ')।' });
    }
    const body = await readBody(req);
    const note = clean(body.note, 300);

    if (parts[4] === 'reject') {
      app.status = 'rejected';
      app.decidedAt = Date.now();
      app.decisionNote = note || 'Team Janmat की जाँच में यह आवेदन मंज़ूर नहीं हो सका।';
      app.pwHash = null;          /* ठुकराए आवेदन के PIN/code server par nahi rakhte */
      app.recoveryHash = null;
      await saveNow();
      broadcastDev('account-application-decision', { at: app.decidedAt, id: app.id, status: 'rejected' });
      return sendJson(res, 200, { ok: true, applicationId: app.id, status: 'rejected' });
    }

    /* खाता-वापसी (PIN + कार्ड दोनों खो गए): नया खाता नहीं बनता — उसी पुराने
       खाते पर आवेदन वाला नया PIN और नया रिकवरी कोड लगता है, सारे सत्र बंद। */
    if (app.kind === 'lost-pin-recovery') {
      const target = (app.targetUserId && findUserById(app.targetUserId)) || findUserByUsername(app.desiredUsername);
      if (!target) {
        return sendJson(res, 404, { error: 'जिस खाते (@' + app.desiredUsername + ') की वापसी माँगी गई थी वह अब नहीं मिला — यह आवेदन अस्वीकार करें।' });
      }
      target.pwHash = app.pwHash;
      target.recoveryHash = app.recoveryHash;
      target.pwSetAt = Date.now();
      target.recoverySetAt = Date.now();
      target.accountStatus = 'active';
      target.tokens = {};   /* हर जगह से लॉगआउट — प्रवेश सिर्फ़ नए PIN से */
      if (!target.devices || typeof target.devices !== 'object') target.devices = {};
      target.devices[app.device] = Date.now();
      db.deviceOwner[app.device] = target.id;
      if (app.fp) db.fpOwner[app.fp] = target.id;
      recordDeviceAccount(target, app.device, app.fp || null);
      app.status = 'approved'; app.decidedAt = Date.now(); app.decisionNote = note;
      app.resultingUserId = target.id; app.replacedUserId = null;
      app.pwHash = null; app.recoveryHash = null;
      await saveNow();
      broadcastDev('account-application-decision', { at: app.decidedAt, id: app.id, status: 'approved', username: target.username });
      return sendJson(res, 200, { ok: true, applicationId: app.id, status: 'approved', resultingUserId: target.id, username: target.username, pinReset: true });
    }

    const replaceUserId = clean(body.replaceUserId, 40);
    const mode = clean(body.mode, 24);
    const conflicts = (app.conflictUserIds || []).map((id) => findUserById(id)).filter((u) => isActiveUser(u));
    let replaceTarget = replaceUserId ? findUserById(replaceUserId) : null;
    if (replaceUserId && !replaceTarget) return sendJson(res, 400, { error: 'बदला जाने वाला पुराना खाता नहीं मिला।' });
    if (!replaceTarget && conflicts.length && mode !== 'additional') {
      return sendJson(res, 400, { error: 'इस फ़ोन पर पुराना खाता मौजूद है। कृपया चुनें: पुराना खाता बदलें (उसका डेटा नए username में आएगा) या अलग दूसरा खाता बनाएँ।', code: 'REPLACE_CHOICE_REQUIRED' });
    }

    const owner = findUserByUsername(app.desiredUsername);
    /* वही पुराना खाता + वही username -> नया खाता बनाने की जगह पुराने पर ही नया PIN लगाओ */
    if (owner && replaceTarget && owner.id === replaceTarget.id) {
      owner.pwHash = app.pwHash;
      owner.recoveryHash = app.recoveryHash;
      owner.pwSetAt = Date.now();
      owner.name = app.name;
      owner.accountStatus = 'active';
      owner.tokens = {};
      if (!owner.devices || typeof owner.devices !== 'object') owner.devices = {};
      owner.devices[app.device] = Date.now();
      db.deviceOwner[app.device] = owner.id;
      if (app.fp) db.fpOwner[app.fp] = owner.id;
      recordDeviceAccount(owner, app.device, app.fp || null);
      const adoptedSame = adoptGuestVotes(owner, app.device);
      app.status = 'approved'; app.decidedAt = Date.now(); app.decisionNote = note;
      app.resultingUserId = owner.id; app.replacedUserId = owner.id;
      app.pwHash = null; app.recoveryHash = null;
      await saveNow();
      broadcastDev('account-application-decision', { at: app.decidedAt, id: app.id, status: 'approved' });
      return sendJson(res, 200, { ok: true, applicationId: app.id, status: 'approved', resultingUserId: owner.id, replacedUserId: owner.id, adoptedVotes: adoptedSame });
    }
    if (owner) {
      return sendJson(res, 409, { error: 'माँगा गया username (@' + app.desiredUsername + ') इस बीच किसी खाते में लग चुका है — आवेदन अस्वीकार करके उपयोगकर्ता से नया username माँगें।' });
    }

    const newUser = {
      id: rid(8),
      name: app.name,
      nameLower: nameKey(app.name),
      username: app.desiredUsername,
      accountStatus: 'active',
      createdAt: Date.now(),
      appliedAt: app.createdAt,
      approvedFromApplication: app.id,
      lastLoginAt: null,
      isDemo: false,
      devices: {},
      tokens: {},
      pwHash: app.pwHash,
      pwSetAt: Date.now(),
      recoveryHash: app.recoveryHash,
    };
    db.users.push(newUser);
    newUser.devices[app.device] = Date.now();
    db.deviceOwner[app.device] = newUser.id;
    if (app.fp) db.fpOwner[app.fp] = newUser.id;
    recordDeviceAccount(newUser, app.device, app.fp || null);
    const adopted = adoptGuestVotes(newUser, app.device);
    if (replaceTarget) mergeAccountInto(replaceTarget, newUser);

    app.status = 'approved';
    app.decidedAt = Date.now();
    app.decisionNote = note;
    app.resultingUserId = newUser.id;
    app.replacedUserId = replaceTarget ? replaceTarget.id : null;
    app.pwHash = null;
    app.recoveryHash = null;
    await saveNow();
    broadcastDev('account-application-decision', { at: app.decidedAt, id: app.id, status: 'approved', username: newUser.username });
    return sendJson(res, 200, {
      ok: true, applicationId: app.id, status: 'approved',
      resultingUserId: newUser.id,
      replacedUserId: app.replacedUserId,
      adoptedVotes: adopted,
      username: newUser.username,
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
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch (_) {
    /* टूटा हुआ %-URL पूरे server को crash न करे */
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }
  if (rel.includes('\0')) {
    /* NUL byte वाला path fs.readFile को synchronous TypeError देता था */
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }
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
/* 🔒 अब default में सिर्फ़ अपनी site के पते (और local test) — '*' सिर्फ़
   तब जब Render में ALLOWED_ORIGINS=* जानबूझकर डाला गया हो। */
const DEFAULT_ORIGINS = 'https://a2zmatdaan.github.io,https://a2zmatdaan-github-io.onrender.com,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3456,http://127.0.0.1:3456';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
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

/* Browser से आने वाले state-changing POST सिर्फ़ अपनी site/allowed
   origin से स्वीकार करो। CORS response header अकेले किसी दूसरी website
   के simple POST को server पर बदलाव करने से नहीं रोकता। बिना Origin
   वाले server/CLI अनुरोध पहले जैसे चलते रहेंगे। */
function apiOriginAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch (_) {
    return false;
  }
}

const server = http.createServer((req, res) => {
  let urlObj;
  try {
    urlObj = new URL(req.url || '/', 'http://localhost');
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  applyCors(req, res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (urlObj.pathname.startsWith('/api/')) {
    if (req.method === 'POST' && !apiOriginAllowed(req)) {
      return sendJson(res, 403, { error: 'यह अनुरोध इस website से स्वीकार नहीं किया जा सकता।' });
    }
    handleApi(req, res, urlObj.pathname).catch((err) => {
      console.error('API error:', err && err.message);
      if (res.headersSent) return res.end();
      const status = err && (err.statusCode === 400 || err.statusCode === 413) ? err.statusCode : 500;
      sendJson(res, status, {
        error: status === 413
          ? 'भेजा गया डेटा बहुत बड़ा है।'
          : status === 400
            ? 'भेजा गया डेटा ठीक प्रारूप में नहीं है।'
            : 'सर्वर में कुछ गड़बड़ हुई। फिर कोशिश करें।',
      });
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
    } else if (sha256(DEV_PASSWORD) === '7da883f52d3db15e3147d771a60b9d50b59bad0d811cebb31334484153ddfb9c' /* पुराने सार्वजनिक हुए default का hash (अक्षरशः शब्द code में नहीं) */) {
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
