'use strict';

/* =====================================================================
   जनमत — frontend v2
   Pages: home · explore · create · election · login · settings · developer
   ===================================================================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const app = document.getElementById('app');

/* ----------------------------- utils ----------------------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]
  ));
}
const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

function timeAgo(ts) {
  const t = Number(ts || 0);
  if (!t) return '—';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'अभी';
  if (m < 60) return m + ' मिनट पहले';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' घंटे पहले';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' दिन पहले';
  return fullDate(t);
}
function fullDate(ts) {
  try {
    return new Date(ts).toLocaleString('hi-IN', {
      timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (_) { return ''; }
}

function genId() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
  const a = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += a[Math.floor(Math.random() * a.length)];
  return out;
}

/* storage that never throws */
const storageWorks = (() => {
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (_) { return false; }
})();
const mem = Object.create(null);
const store = {
  get(k) { try { return storageWorks ? localStorage.getItem(k) : (mem[k] ?? null); } catch (_) { return mem[k] ?? null; } },
  set(k, v) { mem[k] = v; try { if (storageWorks) localStorage.setItem(k, v); } catch (_) {} },
  del(k) { delete mem[k]; try { if (storageWorks) localStorage.removeItem(k); } catch (_) {} },
};

/* --------------------------- device id --------------------------- */
/* 🟢 ek phone = ek device — id teen जगह रखी जाती है:
   localStorage + IndexedDB + cookie. Cache/cookies साफ़ करने पर भी कम-से-कम
   एक जगह से बच जाती है, इसलिए वही नाम और वही खाता वापस मिलता है। */
let DEVICE_ID = null;
let savedNameHint = null;   /* इस फ़ोन से पहले जो नाम इस्तेमाल हुआ */
let savedAccountHint = null; /* इस फ़ोन से जुड़े खाते का नाम + छिपा username */
const DEV_KEY = 'jm_device';

function cookieGet(name) {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch (_) { return null; }
}
function cookieSet(name, val, days) {
  try {
    const d = new Date(Date.now() + (days || 3650) * 864e5);
    document.cookie = name + '=' + encodeURIComponent(val) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  } catch (_) {}
}
function idbOpen() {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open('janmat', 1);
      rq.onupgradeneeded = () => { try { rq.result.createObjectStore('kv'); } catch (_) {} };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (_) { res(null); }
  });
}
async function idbGet(k) {
  const db = await idbOpen();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const tx = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      tx.onsuccess = () => res(tx.result || null);
      tx.onerror = () => res(null);
    } catch (_) { res(null); }
  });
}
async function idbSet(k, v) {
  const db = await idbOpen();
  if (!db) return;
  try {
    db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
  } catch (_) {}
}

/* 🧬 फ़ोन की पहचान — डेटा मिटने के बाद भी वही फ़ोन पहचाना जाए */
let FP = null;
async function initFingerprint() {
  if (FP) return FP;
  const bits = [
    navigator.userAgent, navigator.language,
    (navigator.languages || []).join(','),
    screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || 0),
    window.devicePixelRatio || 1,
    (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ''; } })(),
    navigator.hardwareConcurrency || 0,
    navigator.deviceMemory || 0,
    navigator.platform || '',
    navigator.maxTouchPoints || 0,
  ];
  /* canvas */
  try {
    const c = document.createElement('canvas');
    c.width = 240; c.height = 50;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '16px "Noto Sans Devanagari", Arial';
      ctx.fillStyle = '#123';
      ctx.fillRect(0, 0, 240, 50);
      ctx.fillStyle = '#fff';
      ctx.fillText('जनमत · vote · ' + navigator.userAgent.length, 4, 6);
      ctx.fillStyle = 'rgba(255,180,0,.7)';
      ctx.fillText('॥ १२३ ॥', 140, 26);
      bits.push(c.toDataURL().slice(-160));
    }
  } catch (_) {}
  /* webgl */
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      bits.push(dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '');
      bits.push(String(gl.getParameter(gl.VENDOR)) + '|' + String(gl.getParameter(gl.RENDERER)));
    }
  } catch (_) {}
  const raw = bits.join('|');
  let hash = '';
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    hash = 'fb' + h.toString(16) + 'fb' + raw.length.toString(16);
  }
  FP = 'fp_' + hash.slice(0, 40);
  return FP;
}

async function initDeviceId() {
  if (DEVICE_ID) return DEVICE_ID;
  let saved = store.get(DEV_KEY) || cookieGet(DEV_KEY) || (await idbGet(DEV_KEY));
  if (saved) {
    DEVICE_ID = saved;
    store.set(DEV_KEY, saved); cookieSet(DEV_KEY, saved); idbSet(DEV_KEY, saved);
    return DEVICE_ID;
  }

  /* 🟢 हर फ़ोन/ब्राउज़र की अपनी अलग पहचान — random id */
  const fresh = 'dev_' + genId().replace(/-/g, '') + Math.random().toString(16).slice(2, 10);
  store.set(DEV_KEY, fresh);
  cookieSet(DEV_KEY, fresh);
  idbSet(DEV_KEY, fresh);
  if (store.get(DEV_KEY) === fresh || cookieGet(DEV_KEY) === fresh || (await idbGet(DEV_KEY)) === fresh) {
    DEVICE_ID = fresh;
    return DEVICE_ID;
  }

  /* localStorage बंद है (कुछ प्राइवेट मोड) → फिंगरप्रिंट से काम चलाओ */
  const bits = [
    navigator.userAgent, navigator.language, navigator.languages ? navigator.languages.join(',') : '',
    screen.width + 'x' + screen.height + 'x' + (screen.colorDepth || 0),
    window.devicePixelRatio || 1,
    (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (_) { return ''; } })(),
    navigator.hardwareConcurrency || 0,
    navigator.deviceMemory || 0,
    navigator.platform || '',
    navigator.maxTouchPoints || 0,
  ];
  // canvas fingerprint (thoda aur stable)
  try {
    const c = document.createElement('canvas');
    c.width = 220; c.height = 44;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '16px "Noto Sans Devanagari", Arial';
      ctx.fillStyle = '#123';
      ctx.fillRect(0, 0, 220, 44);
      ctx.fillStyle = '#fff';
      ctx.fillText('जनमत · vote · ' + (navigator.userAgent.length), 4, 6);
      bits.push(c.toDataURL().slice(-120));
    }
  } catch (_) {}
  const raw = bits.join('|');
  let hash = '';
  try {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
    }
  } catch (_) {}
  if (!hash) {
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    hash = 'fb' + h.toString(16) + genId().slice(0, 16);
  }
  DEVICE_ID = 'dev_' + hash.slice(0, 40);
  store.set('jm_device', DEVICE_ID);
  return DEVICE_ID;
}

/* ------------------------------ theme ---------------------------- */

const THEME_KEY = 'jm_theme';
function getThemePref() {
  const t = store.get(THEME_KEY);
  return (t === 'light' || t === 'dark' || t === 'system') ? t : 'system';
}
function systemDark() {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) { return false; }
}
function isDarkNow() {
  const p = getThemePref();
  return p === 'dark' || (p === 'system' && systemDark());
}
function applyTheme() {
  const dark = isDarkNow();
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b0e22' : '#14183a');
}
function setTheme(pref) {
  store.set(THEME_KEY, pref);
  applyTheme();
}
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme();
  });
} catch (_) {}

/* ------------------------------ state ---------------------------- */

const state = {
  user: null,
  token: store.get('jm_token') || null,
  quota: null,
  devToken: store.get('jm_dev_token') || null,
};

/* ------------------------------- api ----------------------------- */

/* Server ka base URL (khali = isi domain par API).
   GitHub Pages (static) + Render (server) combo ke liye template.html me set hota hai. */
/* 🟢 सुरक्षा-कवच: अगर किसी वजह से config.js खाली/ग़ायब हो और साइट GitHub Pages
   पर चल रही हो, तो भी असली सर्वर (Render) ही इस्तेमाल होगा — डेमो प्रीव्यू कभी
   नहीं खुलेगा। (यही वजह थी कि लाइव साइट पर "डेमो प्रीव्यू" बैनर दिख रहा था।) */
const FALLBACK_SERVER = 'https://a2zmatdaan-github-io.onrender.com';
let API_BASE = String(window.JANMAT_API_BASE || '').replace(/\/+$/, '');
if (!API_BASE && /(^|\.)github\.io$/i.test(location.hostname)) API_BASE = FALLBACK_SERVER;
if (API_BASE) window.JANMAT_API_BASE = API_BASE;
function apiUrl(path) { return API_BASE + path; }

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = {};
  if (state.token) headers['x-user-token'] = state.token;
  if (state.devToken) headers['x-dev-token'] = state.devToken;
  if (DEVICE_ID) headers['x-device-id'] = DEVICE_ID;
  if (FP) headers['x-fp'] = FP;
  let body;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  // 🔒 अगर असली सर्वर (Render) सेट है तो LOCAL/डेमो डेटा कभी नहीं बनाएँगे —
  // वरना यूज़र ऐसा चुनाव बना बैठता जो दुनिया में कहीं नहीं होता (यही "कोई
  // नकली चुनाव नहीं" का नियम है)। सर्वर बंद हो तो साफ़ मैसेज + फिर कोशिश।
  if (API_BASE && window.JanmatOffline && window.JanmatOffline.ensure) {
    try { await window.JanmatOffline.ensure(); } catch (_) {}
  } else if (window.JanmatOffline && window.JanmatOffline.ensure) {
    let serverUp = true;
    try { serverUp = await window.JanmatOffline.ensure(); } catch (_) { serverUp = false; }
    if (!serverUp) return window.JanmatOffline.handle(path, Object.assign({}, opts, { headers }));
  }

  let res;
  try {
    res = await fetch(apiUrl(path), { method, headers, body });
  } catch (_) {
    if (!API_BASE && window.JanmatOffline) {
      return window.JanmatOffline.handle(path, Object.assign({}, opts, { headers }));
    }
    showServerDownBar();
    const errDown = new Error('सर्वर से कनेक्शन नहीं बना। Render का सर्वर सो रहा हो सकता है — 30–60 सेकंड रुककर "फिर कोशिश करें" दबाएँ।');
    errDown.code = 'SERVER_DOWN';
    throw errDown;
  }
  let data = {};
  let parsed = false;
  try { data = await res.json(); parsed = true; } catch (_) {}
  if (!parsed && !API_BASE && window.JanmatOffline) {
    try { return window.JanmatOffline.handle(path, Object.assign({}, opts, { headers })); } catch (_) {}
  }
  if (!res.ok) {
    const err = new Error(data.error || 'कुछ गड़बड़ हो गई।');
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

/* ------------------------- live updates (SSE) -------------------- */

let liveSource = null;
let liveFallbackTimer = null;

function closeLive() {
  if (liveSource) { try { liveSource.close(); } catch (_) {} liveSource = null; }
  if (liveFallbackTimer) { clearInterval(liveFallbackTimer); liveFallbackTimer = null; }
}

/**
 * Chunav ke live updates subscribe karo.
 * SSE support na ho ya fail ho to polling par switch ho jaata hai.
 */
function subscribeElection(code, handlers) {
  closeLive();
  // Server hi nahi hai (preview/static mode) to SSE ki koshish mat karo.
  if (window.JANMAT_OFFLINE) return false;
  if (typeof EventSource === 'undefined') return false;
  let gotData = false;
  try {
    liveSource = new EventSource(apiUrl('/api/stream?election=' + encodeURIComponent(code)));
  } catch (_) { return false; }

  liveSource.addEventListener('update', (ev) => {
    gotData = true;
    try {
      const d = JSON.parse(ev.data);
      if (d && d.deleted && handlers.onDeleted) { handlers.onDeleted(); return; }
      if (d && d.election && handlers.onUpdate) handlers.onUpdate(d.election);
    } catch (_) {}
  });
  liveSource.onopen = () => { if (handlers.onStatus) handlers.onStatus('live'); };
  liveSource.onerror = () => {
    if (handlers.onStatus) handlers.onStatus('reconnecting');
    // pehli baar hi fail hua to polling fallback
    if (!gotData && !liveFallbackTimer) {
      liveFallbackTimer = setInterval(handlers.poll, 6000);
    }
  };
  return true;
}

/* ------------------------------ icons ---------------------------- */

const ICON = {
  link: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.5.5l2-2a5 5 0 00-7-7l-1.2 1.2"/><path d="M14 11a5 5 0 00-7.5-.5l-2 2a5 5 0 007 7L12.7 18"/></svg>',
  ballot: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M8 11V4h8v7"/><path d="M9.5 7.5l2 2 3.5-3.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9L12 3.5z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  book: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M8 7h7M8 11h7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  lock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
  warn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5L22 20H2L12 3.5z"/><path d="M12 10v4.5M12 17.4v.1"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M17 6l2 2M14 9l2 2"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#c98a06" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10v5a5 5 0 01-10 0V4z"/><path d="M7 6H4.5a2.5 2.5 0 002.5 4M17 6h2.5a2.5 2.5 0 01-2.5 4"/><path d="M12 14v4M8.5 20h7"/></svg>',
  handshake: '<svg viewBox="0 0 40 40" width="34" height="34" fill="none" stroke="#c98a06" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l7-7 6 6M36 20l-7-7-9 9"/><path d="M11 13l7 7 2-2 5 5"/><path d="M14 27l4 4 8-8"/></svg>',
  search: '<svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="#b3b1c9" stroke-width="2.4" stroke-linecap="round"><circle cx="18" cy="18" r="11"/><path d="M27 27l7 7"/></svg>',
  box: '<svg viewBox="0 0 40 40" width="40" height="40" fill="none" stroke="#b3b1c9" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="12" width="32" height="22" rx="3"/><path d="M14 12V8a3 3 0 013-3h6a3 3 0 013 3v4"/><path d="M14 23l3.5 3.5L26 19"/></svg>',
  user: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.09A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.09A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.09a1.7 1.7 0 001 1.51 1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9c.2.62.76 1.05 1.42 1.05H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.51 1z"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 11.5L12 16l4.5-4.5"/><path d="M4.5 19.5h15"/></svg>',
  shield: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
};

/* ----------------------------- toast ----------------------------- */

function toast(msg, type) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

/* ------------------------- copy helpers -------------------------- */

function pageBase() { return location.href.split('#')[0].split('?')[0]; }
/* शिकायत के लिए सार्वजनिक ईमेल — खाली हो तो सिर्फ़ फ़ॉर्म दिखेगा।
   अपना ईमेल यहाँ लिख दो: GRIEVANCE_EMAIL = 'naam@example.com' */
const GRIEVANCE_EMAIL = 'pawanverma992930@gmail.com';

function shareUrl(code) { return pageBase() + '#/e/' + code; }

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (_) { return false; }
}
function bindCopyButtons(root = document) {
  $$('[data-copy]', root).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const ok = await copyText(btn.getAttribute('data-copy'));
      toast(ok ? 'लिंक कॉपी हो गया' : 'कॉपी नहीं हो सका — लिंक खुद चुनकर कॉपी करें', ok ? 'ok' : 'err');
    });
  });
}
function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function csvCell(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return '"' + s + '"';
}

/* =====================================================================
   टाइमर हेल्पर — चुनाव की अवधि और बचा समय
   ===================================================================== */

const SITE_URLS = ['a2zmatdaan.github.io', 'a2zmatdaan-github-io.onrender.com'];

function shortDate(ts) {
  try {
    return new Date(ts).toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (_) { return ''; }
}

function fmtDuration(min) {
  const m = Math.round(Number(min) || 0);
  if (m <= 0) return '—';
  if (m < 60) return m + ' मिनट';
  if (m < 1440) {
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' घंटे' + (r ? ' ' + r + ' मिनट' : '');
  }
  const d = Math.floor(m / 1440), hr = Math.round((m % 1440) / 60);
  return d + ' दिन' + (hr ? ' ' + hr + ' घंटे' : '');
}

/** बचा समय — "2 घंटे 14 मिनट बाकी" / "4 मिनट 09 सेकंड बाकी" */
/* ⏱️ बचा समय — हर सेकंड बदलता हुआ (दिन/घंटे/मिनट सब में सेकंड दिखते हैं) */
function fmtLeft(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (total <= 0) return 'समय पूरा';
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const ss = String(sec).padStart(2, '0');
  if (d > 0) return `${d} दिन ${h} घंटे ${m} मिनट ${ss} सेकंड बाकी`;
  if (h > 0) return `${h} घंटे ${m} मिनट ${ss} सेकंड बाकी`;
  if (m > 0) return `${m} मिनट ${ss} सेकंड बाकी`;
  return `${ss} सेकंड बाकी`;
}

/** 🔒 एक जगह से नियम तय — चुनाव चलते समय निर्माता कुछ नहीं बदल सकता */
function electionLock(e) {
  if (!e) return { locked: false, timeUp: false, left: 0 };
  const left = e.endsAt ? Math.max(0, e.endsAt - Date.now()) : 0;
  const timeUp = !!e.endsAt && left <= 0;
  return { locked: !e.closed && !timeUp, timeUp, left };
}

/* सर्वर बंद/सोया हुआ — साफ़ पट्टी + फिर कोशिश (fake डेटा नहीं बनेगा) */
function showServerDownBar() {
  window.JANMAT_OFFLINE = false;
  if (document.getElementById('offlineBar')) return;
  const bar = document.createElement('div');
  bar.id = 'offlineBar';
  bar.className = 'offline-bar';
  bar.innerHTML = '<b>सर्वर से कनेक्शन नहीं बना</b> — Render का सर्वर सो रहा हो सकता है (पहली बार 30–60 सेकंड)। '
    + 'तब तक कुछ भी सेव नहीं होगा। <button type="button" class="offline-retry" id="srvDownRetry">फिर कोशिश करें</button>';
  document.body.insertBefore(bar, document.body.firstChild);
  document.body.classList.add('has-offline-bar');
  const btn = bar.querySelector('#srvDownRetry');
  if (btn) btn.addEventListener('click', () => { btn.textContent = 'कोशिश हो रही है…'; location.reload(); });
}

/* =====================================================================
   लॉगिन कार्ड इमेज — नाम वाली इमेज, जिसे सँभाल कर रखना है
   (कैनवास से बनती है — कोई बाहरी सर्विस नहीं, ऑफ़लाइन भी चलती है)
   ===================================================================== */

function loginCardCanvas(name, when, recoveryCode, username) {
  const W = 1080, H = 1360;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const safe = (name || 'मतदाता').slice(0, 30);
  const dateStr = when || new Date().toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric' });

  // पृष्ठभूमि
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#2b1163');
  g.addColorStop(0.5, '#4b2ea8');
  g.addColorStop(1, '#0d1440');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);

  // हल्के गोले (सजावट)
  const blobs = [[140, 190, 260, 'rgba(255,255,255,.10)'], [980, 300, 200, 'rgba(255,190,90,.16)'], [860, 1240, 320, 'rgba(255,255,255,.07)']];
  blobs.forEach(([cx, cy, r, col]) => {
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = rg;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  });

  // सफ़ेद कार्ड
  const pad = 64, cardX = pad, cardY = 96, cardW = W - pad * 2, cardH = 1000;
  x.save();
  x.shadowColor = 'rgba(0,0,0,.35)';
  x.shadowBlur = 40; x.shadowOffsetY = 18;
  roundRect(x, cardX, cardY, cardW, cardH, 44);
  x.fillStyle = '#ffffff';
  x.fill();
  x.restore();

  // शीर्ष पट्टी
  x.save();
  roundRect(x, cardX, cardY, cardW, 150, 44);
  x.clip();
  const hg = x.createLinearGradient(cardX, 0, cardX + cardW, 0);
  hg.addColorStop(0, '#ff7a18');
  hg.addColorStop(1, '#ffb347');
  x.fillStyle = hg;
  x.fillRect(cardX, cardY, cardW, 150);
  x.restore();

  x.textBaseline = 'middle';
  x.fillStyle = '#ffffff';
  x.font = '700 44px "Noto Sans Devanagari", system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
  x.fillText('A2Z Janmat', cardX + 48, cardY + 62);
  x.font = '600 26px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.fillText('लोकतंत्र · आपकी आवाज़', cardX + 48, cardY + 108);
  // मुहर
  x.beginPath(); x.arc(cardX + cardW - 78, cardY + 76, 46, 0, Math.PI * 2);
  x.fillStyle = 'rgba(255,255,255,.22)'; x.fill();
  x.fillStyle = '#fff'; x.font = '700 42px system-ui, sans-serif';
  x.textAlign = 'center'; x.fillText('🗳', cardX + cardW - 78, cardY + 78); x.textAlign = 'left';

  // "यह आपका लॉगिन कार्ड है"
  x.fillStyle = '#7a6fa8';
  x.font = '600 24px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillText('यह आपका लॉगिन कार्ड है', cardX + 56, cardY + 210);

  // नाम
  x.fillStyle = '#170c46';
  let fs = 76;
  x.font = '800 ' + fs + 'px "Noto Sans Devanagari", system-ui, sans-serif';
  while (x.measureText(safe).width > cardW - 112 && fs > 34) {
    fs -= 4;
    x.font = '800 ' + fs + 'px "Noto Sans Devanagari", system-ui, sans-serif';
  }
  x.fillText(safe, cardX + 56, cardY + 300);

  // Username — यही असली login-ID है, इसलिए नाम के ठीक नीचे बड़े अक्षरों में
  const hasUsername = !!username;
  const shiftY = hasUsername ? 46 : 0;
  if (hasUsername) {
    x.fillStyle = '#4b2ea8';
    x.font = '800 42px ui-monospace, Consolas, monospace';
    x.fillText('@' + String(username), cardX + 56, cardY + 356);
  }

  // नाम के नीचे लकीर
  x.fillStyle = '#ece8ff';
  x.fillRect(cardX + 56, cardY + 352 + shiftY, cardW - 112, 3);

  // मुख्य नोट
  const note = 'इसे अच्छे से सँभाल कर रखें —';
  const note2 = 'इसी से आप लॉगिन कर पाएंगे।';
  x.fillStyle = '#b3241c';
  x.font = '700 40px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillText(note, cardX + 56, cardY + 424 + shiftY);
  x.fillStyle = '#170c46';
  x.fillText(note2, cardX + 56, cardY + 478 + shiftY);

  // सूचना बॉक्स
  x.save();
  roundRect(x, cardX + 56, cardY + 530 + shiftY, cardW - 112, 168, 24);
  x.fillStyle = '#f5f2ff'; x.fill();
  x.restore();
  const lines = [
    'लॉगिन का तरीक़ा: ऊपर वाला username + आपका 6–10 अंकों का PIN।',
    'इसी नाम के कई लोग हो सकते हैं — पर username सिर्फ़ आपका है।',
    'PIN किसी को न बताएँ। भूल जाएँ तो नीचे वाला रिकवरी कोड काम आएगा।',
  ];
  x.font = '500 25px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillStyle = '#3b3266';
  lines.forEach((ln, i) => x.fillText('•  ' + ln, cardX + 84, cardY + 586 + shiftY + i * 44));

  // 🔐 गुप्त रिकवरी कोड (सिर्फ़ खाता बनते/पासवर्ड बदलते समय)
  if (recoveryCode) {
    x.save();
    roundRect(x, cardX + 56, cardY + 714 + shiftY, cardW - 300, 96, 20);
    x.fillStyle = '#fff4d6'; x.fill();
    x.strokeStyle = '#e5b93e'; x.lineWidth = 2; x.stroke();
    x.restore();
    x.fillStyle = '#8a5a00';
    x.font = '700 21px "Noto Sans Devanagari", system-ui, sans-serif';
    x.fillText('गुप्त रिकवरी कोड — PIN भूलने पर यही काम आएगा', cardX + 84, cardY + 742 + shiftY);
    x.fillStyle = '#170c46';
    x.font = '800 40px ui-monospace, Consolas, monospace';
    x.fillText(String(recoveryCode), cardX + 84, cardY + 782 + shiftY);
  }

  // तारीख़
  x.font = '600 24px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillStyle = '#8b82b4';
  x.fillText('खाता बनने/लॉगिन की तारीख़: ' + dateStr, cardX + 56, cardY + (recoveryCode ? 852 : 760) + shiftY);

  // होलोग्राम-सा निशान
  x.save();
  const hx = cardX + cardW - 190, hy = cardY + 740 + shiftY;
  const rg2 = x.createLinearGradient(hx, hy, hx + 130, hy + 130);
  rg2.addColorStop(0, '#ffd76e'); rg2.addColorStop(.5, '#ff9d4d'); rg2.addColorStop(1, '#7a5cff');
  x.beginPath(); x.arc(hx + 65, hy + 55, 62, 0, Math.PI * 2);
  x.fillStyle = rg2; x.fill();
  x.fillStyle = '#2b1163'; x.textAlign = 'center';
  x.font = '800 22px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillText('असली', hx + 65, hy + 44);
  x.fillText('कार्ड', hx + 65, hy + 72);
  x.textAlign = 'left';
  x.restore();

  // कार्ड के अंदर नीचे की पट्टी
  x.fillStyle = '#f0edff';
  x.fillRect(cardX, cardY + cardH - 104, cardW, 104);
  x.fillStyle = '#5b4bb8';
  x.font = '600 23px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillText('यह कार्ड सिर्फ़ आपके लिए है — किसी और को न दें।', cardX + 56, cardY + cardH - 52);

  // बाहर वॉटरमार्क — दोनों पते
  x.fillStyle = 'rgba(255,255,255,.94)';
  x.font = '700 34px system-ui, "Segoe UI", Roboto, sans-serif';
  x.textAlign = 'center';
  x.fillText(SITE_URLS[0], W / 2, H - 150);
  x.font = '600 30px system-ui, "Segoe UI", Roboto, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.86)';
  x.fillText(SITE_URLS[1], W / 2, H - 100);
  x.font = '600 24px "Noto Sans Devanagari", system-ui, sans-serif';
  x.fillStyle = 'rgba(255,255,255,.62)';
  x.fillText('इन दोनों पतों पर यह मंच हमेशा मिलेगा', W / 2, H - 50);
  x.textAlign = 'left';

  return cv;
}

function roundRect(ctx, x0, y0, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
  ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
  ctx.arcTo(x0, y0 + h, x0, y0, r);
  ctx.arcTo(x0, y0, x0 + w, y0, r);
  ctx.closePath();
}

function loginCardFileName(name) {
  const safe = String(name || 'janmat').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'janmat';
  return 'a2z-janmat-login-' + safe + '.png';
}

/** इमेज बनाओ, दिखाओ और डाउनलोड कराओ */
function openLoginCard(name, opts) {
  const first = !opts || opts.first !== false;
  let canvas;
  try {
    canvas = loginCardCanvas(name, undefined, opts && opts.recoveryCode, opts && opts.username);
  } catch (err) {
    return;
  }
  const dataUrl = canvas.toDataURL('image/png');
  const fileName = loginCardFileName((opts && opts.username) || name);

  // डाउनलोड (पहली बार लॉगिन पर अपने आप)
  if (first) {
    try {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 800);
    } catch (_) {}
  }

  showLoginCardModal(dataUrl, fileName, name, first, opts && opts.recoveryCode, opts && opts.username);
}

function showLoginCardModal(dataUrl, fileName, name, first, recoveryCode, username) {
  const old = document.getElementById('loginCardModal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'lc-overlay';
  wrap.id = 'loginCardModal';
  wrap.innerHTML = `
    <div class="lc-modal" role="dialog" aria-modal="true" aria-label="लॉगिन कार्ड">
      <button class="lc-x" id="lcClose" aria-label="बंद करें">✕</button>
      <h3>${first ? 'आपका लॉगिन कार्ड' : 'लॉगिन कार्ड'}</h3>
      <p class="lc-sub">${first ? 'इमेज डाउनलोड हो रही है — गैलरी/डाउनलोड्स में देखें।' : 'नीचे से इमेज डाउनलोड करें।'}</p>
      <img src="${dataUrl}" alt="लॉगिन कार्ड — ${esc(name)}" />
      <div class="lc-note">🔒 <b>इसे अच्छे से सँभाल कर रखें</b> — लॉगिन के लिए आपका username${username ? ' <b>@' + esc(username) + '</b>' : ''} और गुप्त PIN ही आपकी चाबी है।</div>
      ${recoveryCode ? `<div class="recovery-show"><b>🔑 आपका गुप्त रिकवरी कोड</b><code>${esc(recoveryCode)}</code><span>PIN भूल जाएँ तो खाता इसी कोड से वापस मिलेगा। यह कोड <b>हमेशा यही रहेगा</b> — PIN बदलने से नहीं बदलता; सिर्फ़ Settings से नया कोड बनाने पर बदलेगा। Image के अलावा कोड को diary/कागज़ पर भी लिख लें — image delete हो जाए तो भी काम आएगा। कोड किसी को न दें।</span><button type="button" class="btn btn-ghost btn-sm" id="lcCopyRecovery">कोड कॉपी करें</button><button type="button" class="btn btn-ghost btn-sm" id="lcDlRecoveryTxt">कोड की Text file भी डाउनलोड करें</button></div>` : ''}
      <div class="lc-actions">
        <a class="btn btn-primary" id="lcDl" download="${esc(fileName)}" href="${dataUrl}">इमेज फिर डाउनलोड करें</a>
        <button class="btn btn-ghost" id="lcClose2">बंद करें</button>
      </div>
      <p class="lc-urls">${SITE_URLS[0]}<br>${SITE_URLS[1]}</p>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  document.getElementById('lcClose').addEventListener('click', close);
  document.getElementById('lcClose2').addEventListener('click', close);
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
  const copyBtn = document.getElementById('lcCopyRecovery');
  if (copyBtn && recoveryCode) copyBtn.addEventListener('click', async () => {
    toast(await copyText(recoveryCode) ? 'रिकवरी कोड कॉपी हो गया — सुरक्षित जगह रख दें' : 'कॉपी नहीं हुआ — कोड कार्ड पर लिखा है', 'ok');
  });
  const dlTxt = document.getElementById('lcDlRecoveryTxt');
  if (dlTxt && recoveryCode) dlTxt.addEventListener('click', () => {
    const txt = [
      'A2Z Janmat — मेरा लॉगिन विवरण (गुप्त रखें)',
      'नाम: ' + name,
      username ? 'Username: @' + username : '',
      'गुप्त रिकवरी कोड: ' + recoveryCode,
      '',
      'PIN आपने खुद चुना था — सुरक्षा के लिए यहाँ नहीं लिखा है।',
      'PIN भूल जाएँ तो लॉगिन पेज पर "PIN भूल गए" से यही कोड लगेगा।',
      'यह कोड हमेशा यही रहेगा; सिर्फ़ Settings से नया कोड बनाने पर बदलेगा।',
      'यह कोड/file किसी को न दें और कहीं सार्वजनिक जगह न डालें।',
    ].filter(Boolean).join('\n');
    downloadFile('janmat-recovery-' + (username || 'code') + '.txt', txt, 'text/plain;charset=utf-8');
    toast('रिकवरी कोड की text file डाउनलोड हुई — image के अलावा इसे भी सुरक्षित जगह रखें', 'ok');
  });
}

/* --------------------------- nav / auth -------------------------- */

function renderNavAuth() {
  const box = document.getElementById('navAuth');
  if (!box) return;
  if (state.user) {
    const initial = (state.user.name || '?').trim().charAt(0).toUpperCase();
    box.innerHTML = `
      <a class="user-chip" href="#/settings" title="${state.user.username ? '@' + esc(state.user.username) + ' · ' : ''}सेटिंग्स">
        <span class="avatar">${esc(initial)}</span>
        <span class="user-chip-name">${esc(state.user.name)}${state.user.username ? ' <small style="opacity:.72">@' + esc(state.user.username) + '</small>' : ''}</span>
      </a>`;
  } else {
    box.innerHTML = `<a class="btn btn-ghost btn-sm" href="#/login">लॉगिन करें</a>`;
  }
}

function setActiveNav(name) {
  $$('.nav-links a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

function normalizeUsernameClient(v) {
  return String(v || '').trim().toLowerCase().replace(/^@+/, '').replace(/\s+/g, '_');
}
function usernameErrorClient(v) {
  const u = normalizeUsernameClient(v);
  if (!u) return 'अपना username चुनें — यही आपकी असली login-ID होगी।';
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(u)) return 'Username 3–20 अक्षरों का रखें: शुरुआत अंग्रेज़ी अक्षर (a–z) से, फिर अक्षर, अंक या _ (जैसे pawan_verma)।';
  if (u.includes('__') || u.endsWith('_')) return 'Username में लगातार दो _ या अंत में _ न रखें।';
  return '';
}
function pinErrorClient(pin, username) {
  const s = String(pin == null ? '' : pin);
  if (!/^[0-9]{6,10}$/.test(s)) return 'PIN सिर्फ़ 6 से 10 अंकों का रखें (सिर्फ़ नंबर 0–9)।';
  if (/^([0-9])\1+$/.test(s)) return 'PIN में सारे अंक एक जैसे न रखें।';
  let asc = true, desc = true;
  for (let i = 1; i < s.length; i++) {
    const d = Number(s[i]) - Number(s[i - 1]);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  const common = ['123456','654321','1234567','12345678','123456789','1234567890','987654','9876543210','112233','121212','123123','111111','000000','102030','246810','135790'];
  if (asc || desc || common.includes(s)) return 'यह PIN बहुत आम है — कोई ऐसा नंबर चुनें जो सिर्फ़ आपको याद रहे।';
  if (username && normalizeUsernameClient(username).includes(s)) return 'PIN अपने username जैसा न रखें।';
  return '';
}

async function checkUsernameNow(input, statusEl) {
  if (!input || !statusEl) return { unknown: true };
  const u = normalizeUsernameClient(input.value);
  input.value = u;
  const err = usernameErrorClient(u);
  if (err) {
    input.dataset.usernameState = 'invalid';
    statusEl.innerHTML = '<span class="u-bad">⚠ ' + esc(err) + '</span>';
    return { available: false, valid: false, error: err, username: u };
  }
  if (input.dataset.skipAvailability === '1') {
    /* खाता-वापसी आवेदन: username पहले से लिया हुआ ही सही है (अपना पुराना खाता) */
    input.dataset.usernameState = 'skipped';
    statusEl.innerHTML = '<span class="u-wait">खाता-वापसी: अपना मौजूदा (पुराना) username ही लिखें — मंज़ूरी के बाद उसी खाते पर नया PIN लगेगा।</span>';
    return { available: true, valid: true, skipped: true, username: u };
  }
  const seq = (Number(input.dataset.checkSeq || 0) + 1);
  input.dataset.checkSeq = String(seq);
  input.dataset.usernameState = 'checking';
  statusEl.innerHTML = '<span class="u-wait">जाँच रहे हैं कि @' + esc(u) + ' खाली है या नहीं…</span>';
  try {
    const data = await api('/api/auth/username-available?u=' + encodeURIComponent(u));
    if (Number(input.dataset.checkSeq || 0) !== seq) return data;
    if (data.available) {
      input.dataset.usernameState = 'available';
      statusEl.innerHTML = '<span class="u-ok">✓ @' + esc(data.username || u) + ' उपलब्ध है — यह आपका हो सकता है।</span>';
    } else {
      input.dataset.usernameState = 'taken';
      const sug = Array.isArray(data.suggestions) ? data.suggestions : [];
      statusEl.innerHTML = '<span class="u-bad">✕ ' + esc(data.error || 'यह username पहले से उपयोग में है।') + '</span>'
        + (sug.length ? '<span class="u-sugs">खाली सुझाव: ' + sug.map((s) => '<button type="button" class="username-suggestion" data-username-suggestion="' + esc(s) + '">@' + esc(s) + '</button>').join(' ') + '</span>' : '');
    }
    return data;
  } catch (e) {
    if (Number(input.dataset.checkSeq || 0) !== seq) return { unknown: true };
    input.dataset.usernameState = 'unknown';
    statusEl.innerHTML = '<span class="u-wait">अभी जाँच नहीं हो पाई — आगे बढ़ने पर सर्वर अंतिम जाँच करेगा।</span>';
    return { unknown: true, error: e.message };
  }
}

function bindUsernameAvailability(input, statusEl) {
  if (!input || !statusEl) return;
  input.addEventListener('input', () => {
    const before = input.value;
    const cleaned = normalizeUsernameClient(before);
    if (before !== cleaned) input.value = cleaned;
    input.dataset.usernameState = 'typing';
    clearTimeout(input._usernameTimer);
    if (!cleaned) { statusEl.textContent = ''; return; }
    const err = usernameErrorClient(cleaned);
    statusEl.innerHTML = err
      ? '<span class="u-bad">⚠ ' + esc(err) + '</span>'
      : '<span class="u-wait">जाँच रहे हैं…</span>';
    input._usernameTimer = setTimeout(() => { checkUsernameNow(input, statusEl); }, 380);
  });
  input.addEventListener('blur', () => {
    if (normalizeUsernameClient(input.value)) checkUsernameNow(input, statusEl);
  });
  statusEl.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('[data-username-suggestion]') : null;
    if (!b) return;
    input.value = b.dataset.usernameSuggestion;
    input.focus();
    checkUsernameNow(input, statusEl);
  });
}

function applyAuthResponse(res) {
  state.user = res.user;
  state.token = res.token;
  state.quota = res.quota;
  store.set('jm_token', res.token);
  renderNavAuth();
  /* 🟢 इस फ़ोन से पहले बिना लॉगिन जो वोट पड़े थे, वे अब इस खाते से जुड़ गए */
  if (res.adoptedVotes) {
    setTimeout(() => {
      toast(res.adoptedVotes + ' पहले वाला मेहमान-वोट अब ' + res.user.name + (res.user.username ? ' (@' + res.user.username + ')' : '') + ' से जुड़ गया — गिनती एक ही रहेगी।', 'ok');
    }, 1100);
  }
  /* 🎴 रिकवरी कोड वाला लॉगिन कार्ड — खाता बनते/claim पर (recovery पर कोड वही रहता है) */
  if (res.recoveryCode) {
    try { openLoginCard(res.user.name, { first: true, recoveryCode: res.recoveryCode, username: res.user.username }); } catch (_) {}
  } else if (res.user && !res.user.username) {
    setTimeout(() => maybePromptUsername(), 700);
  }
  return res;
}

async function loginWithCredentials(username, password) {
  const res = await api('/api/auth/login', { method: 'POST', body: { username: normalizeUsernameClient(username), password, deviceId: DEVICE_ID } });
  return applyAuthResponse(res);
}

async function registerWithCredentials(name, username, password) {
  const res = await api('/api/auth/register', { method: 'POST', body: { name, username: normalizeUsernameClient(username), password, deviceId: DEVICE_ID } });
  return applyAuthResponse(res);
}

async function migrateOldAccount(data) {
  const res = await api('/api/auth/migrate', { method: 'POST', body: { ...data, username: normalizeUsernameClient(data.username), deviceId: DEVICE_ID } });
  return applyAuthResponse(res);
}

async function recoverWithCode(username, recoveryCode, newPassword) {
  const res = await api('/api/auth/recover', { method: 'POST', body: { username: normalizeUsernameClient(username), recoveryCode, newPassword, deviceId: DEVICE_ID } });
  return applyAuthResponse(res);
}

/* पुराने सत्र से लॉगिन उपयोगकर्ता के लिए पहली बार username चुनना */
let usernamePromptShown = false;
function maybePromptUsername() {
  if (!state.user || state.user.username || usernamePromptShown) return;
  usernamePromptShown = true;
  showUsernameSetupModal();
}
function showUsernameSetupModal() {
  if (!state.user) return;
  const old = document.getElementById('usernameSetupModal');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'lc-overlay';
  wrap.id = 'usernameSetupModal';
  wrap.innerHTML = `
    <div class="lc-modal username-modal" role="dialog" aria-modal="true" aria-label="अपना username चुनें">
      <button class="lc-x" id="usernameSetupClose" aria-label="बंद करें">✕</button>
      <h3>अपना Username चुनें</h3>
      <p class="lc-sub">अब लॉगिन <b>username + PIN</b> से होता है। आपका नाम (${esc(state.user.name)}) प्रोफ़ाइल में वैसे ही रहेगा — username आपकी स्थायी login-ID होगी, जो किसी और के पास नहीं हो सकती।</p>
      <input id="setupUsername" type="text" placeholder="username जैसे pawan_verma" maxlength="20" autocomplete="username" aria-label="Username" autocapitalize="none" spellcheck="false" />
      <div id="setupUsernameStatus" class="username-status" aria-live="polite"></div>
      <div class="lc-actions">
        <button class="btn btn-primary" id="setupUsernameSave" type="button">Username पक्का करें</button>
        <button class="btn btn-ghost" id="setupUsernameLater" type="button">बाद में</button>
      </div>
      <p class="muted small">ध्यान दें: username एक बार तय होने के बाद बदलेगा नहीं। ध्यान से चुनें और लॉगिन कार्ड पर रख लें।</p>
    </div>`;
  document.body.appendChild(wrap);
  const input = document.getElementById('setupUsername');
  const status = document.getElementById('setupUsernameStatus');
  const save = document.getElementById('setupUsernameSave');
  bindUsernameAvailability(input, status);
  const close = () => wrap.remove();
  document.getElementById('usernameSetupClose').addEventListener('click', close);
  document.getElementById('setupUsernameLater').addEventListener('click', close);
  wrap.addEventListener('click', (ev) => { if (ev.target === wrap) close(); });
  save.addEventListener('click', async () => {
    const u = normalizeUsernameClient(input.value);
    const err = usernameErrorClient(u);
    if (err) return toast(err, 'err');
    save.disabled = true;
    save.textContent = 'जाँच रहे हैं…';
    try {
      const chk = await checkUsernameNow(input, status);
      if (chk && chk.available === false) throw new Error(chk.error || 'यह username पहले से उपयोग में है।');
      const res = await api('/api/auth/set-username', { method: 'POST', body: { username: u } });
      state.user = res.user;
      state.quota = res.quota || state.quota;
      renderNavAuth();
      close();
      toast('आपका username @' + res.user.username + ' बन गया। अब लॉगिन इसी से होगा।', 'ok');
      if (String(location.hash || '').startsWith('#/settings')) route();
    } catch (e) {
      toast(e.message, 'err');
      if (e.code === 'USERNAME_TAKEN') checkUsernameNow(input, status);
    }
    save.disabled = false;
    save.textContent = 'Username पक्का करें';
  });
  setTimeout(() => input.focus(), 60);
}

async function logoutUser() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  state.user = null;
  state.token = null;
  state.quota = null;
  store.del('jm_token');
  usernamePromptShown = false;
  renderNavAuth();
  toast('लॉगआउट हो गया', 'ok');
  location.hash = '#/';
}

/* 🔐 इस फ़ोन पर पहले चला नाम सिर्फ़ सुझाव के लिए — बिना पासवर्ड अपने आप लॉगिन अब नहीं */
async function tryAutoLogin() {
  if (state.token) return { ok: true, already: true };
  try {
    const res = await api('/api/auth/auto', { method: 'POST', body: { deviceId: DEVICE_ID } });
    return { ok: false, hint: res.hint || null };
  } catch (_) { return { ok: false, hint: null }; }
}

async function refreshMe() {
  if (!state.token) { state.user = null; return null; }
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.quota = me.quota;
    renderNavAuth();
    if (state.user && !state.user.username) setTimeout(() => maybePromptUsername(), 900);
    return me;
  } catch (err) {
    if (err.status === 401) {
      state.user = null;
      state.token = null;
      store.del('jm_token');
      renderNavAuth();
    }
    return null;
  }
}

/* =====================================================================
   Shared UI pieces
   ===================================================================== */

function loginCardHTML(opts = {}) {
  const title = opts.title || 'Username + PIN से लॉगिन';
  const sub = opts.sub || 'मोबाइल नंबर, Gmail या OTP नहीं लगेगा। आपका नाम प्रोफ़ाइल में दिखेगा — लॉगिन आपकी स्थायी username-ID और 6–10 अंकों के गुप्त PIN से होगा।';
  return `
  <div class="panel login-card" id="inlineLogin">
    <div class="login-card-ico">${ICON.user}</div>
    <h3>${esc(title)}</h3>
    <p class="muted">${esc(sub)}</p>
    <form id="inlineLoginForm" autocomplete="on">
      <div class="auth-tabs auth-tabs-3" role="tablist" aria-label="लॉगिन, नया खाता या पुराना खाता">
        <button type="button" class="auth-tab active" data-auth-mode="login">लॉगिन</button>
        <button type="button" class="auth-tab" data-auth-mode="register">नया खाता</button>
        <button type="button" class="auth-tab" data-auth-mode="old">पुराना खाता</button>
      </div>

      <div id="authLoginFields">
        <label class="auth-label" for="inlineUsernameLogin">आपका Username</label>
        <input id="inlineUsernameLogin" type="text" placeholder="जैसे pawan_verma" maxlength="20" aria-label="Username" autocomplete="username" autocapitalize="none" spellcheck="false" />
        <label class="auth-label" for="inlinePinLogin">गुप्त PIN / पासवर्ड</label>
        <input id="inlinePinLogin" type="password" placeholder="आपका PIN लिखें" maxlength="64" aria-label="PIN या पासवर्ड" autocomplete="current-password" />
      </div>

      <div id="authRegisterFields" hidden>
        <label class="auth-label" for="inlineName">आपका असली नाम (प्रोफ़ाइल में दिखेगा)</label>
        <input id="inlineName" type="text" placeholder="जैसे: रवि शर्मा" maxlength="30" aria-label="आपका असली नाम" autocomplete="name" />
        <label class="auth-label" for="inlineUsername">अपना Username चुनें (सिर्फ़ आपका, हमेशा के लिए)</label>
        <input id="inlineUsername" type="text" placeholder="जैसे Ravi Verma" maxlength="20" aria-label="नया username" autocomplete="username" autocapitalize="none" spellcheck="false" />
        <div id="inlineUsernameStatus" class="username-status" aria-live="polite"></div>
        <label class="auth-label" for="inlinePassword">6–10 अंकों का गुप्त PIN बनाएँ</label>
        <input id="inlinePassword" type="password" inputmode="numeric" placeholder="सिर्फ़ नंबर, 6–10 अंक" maxlength="10" aria-label="नया PIN" autocomplete="new-password" />
        <input id="inlinePasswordConfirm" type="password" inputmode="numeric" placeholder="वही PIN दोबारा लिखें" maxlength="10" aria-label="PIN दोबारा" autocomplete="new-password" />
      </div>

      <div id="authOldFields" hidden>
        <p class="auth-help">पहले सिर्फ़ नाम या नाम+पासवर्ड से खाता चला था? वही पुराना नाम (और बना हो तो पुराना पासवर्ड) लिखकर, अब अपना स्थायी username + PIN लगा लीजिए। आपके चुनाव और वोट उसी खाते में रहेंगे।</p>
        <label class="auth-label" for="inlineOldName">पुराना नाम (ठीक वही जो पहले चलता था)</label>
        <input id="inlineOldName" type="text" placeholder="आपका पुराना नाम" maxlength="30" aria-label="पुराना नाम" autocomplete="name" />
        <label class="auth-label" for="inlineOldPassword">पुराना पासवर्ड (अगर बनाया था)</label>
        <input id="inlineOldPassword" type="password" placeholder="पुराना पासवर्ड — न बना हो तो खाली छोड़ें" maxlength="64" aria-label="पुराना पासवर्ड" autocomplete="current-password" />
        <label class="auth-label" for="inlineOldUsername">नया Username चुनें</label>
        <input id="inlineOldUsername" type="text" placeholder="जैसे Ravi Verma" maxlength="20" aria-label="पुराने खाते के लिए username" autocomplete="username" autocapitalize="none" spellcheck="false" />
        <div id="inlineOldUsernameStatus" class="username-status" aria-live="polite"></div>
        <label class="auth-label" for="inlineOldPin">नया 6–10 अंकों का PIN</label>
        <input id="inlineOldPin" type="password" inputmode="numeric" placeholder="सिर्फ़ नंबर, 6–10 अंक" maxlength="10" aria-label="नया PIN" autocomplete="new-password" />
        <input id="inlineOldPinConfirm" type="password" inputmode="numeric" placeholder="वही PIN दोबारा लिखें" maxlength="10" aria-label="नया PIN दोबारा" autocomplete="new-password" />
      </div>

      <div id="inlineAuthError" class="auth-error" role="alert" aria-live="polite" hidden></div>
      <button class="btn btn-primary" type="submit" id="inlineLoginBtn">लॉगिन करें</button>
    </form>

    <div class="auth-links">
      <button type="button" class="linklike" id="inlineForgot">PIN भूल गए?</button>
      <button type="button" class="linklike" id="inlineForgotUsername">Username भूल गए / दूसरा खाता चाहिए?</button>
    </div>

    <div id="inlineRecover" class="recover-box" hidden>
      <h4>🔑 रिकवरी कोड से नया PIN</h4>
      <p class="muted small">अपना <b>username</b>, लॉगिन कार्ड पर लिखा <b>गुप्त रिकवरी कोड</b> और नया 6–10 अंकों का PIN डालें। सिर्फ़ username से PIN नहीं बदलेगा — कोड ज़रूरी है। <b>कोड सफल होने के बाद भी वही रहता है</b> — यही कार्ड हमेशा चलेगा।</p>
      <input id="inlineRecoverUsername" type="text" placeholder="आपका username" maxlength="20" aria-label="रिकवरी के लिए username" autocomplete="username" autocapitalize="none" spellcheck="false" />
      <input id="inlineRecoveryCode" type="text" placeholder="रिकवरी कोड (जैसे ABCD-EFGH-JKLM)" maxlength="20" aria-label="रिकवरी कोड" autocomplete="off" style="text-transform:uppercase" />
      <input id="inlineNewPassword" type="password" inputmode="numeric" placeholder="नया PIN (6–10 अंक)" maxlength="10" aria-label="नया PIN" autocomplete="new-password" />
      <input id="inlineNewPasswordConfirm" type="password" inputmode="numeric" placeholder="नया PIN दोबारा" maxlength="10" aria-label="नया PIN दोबारा" autocomplete="new-password" />
      <div id="inlineRecoverError" class="auth-error" role="alert" aria-live="polite" hidden></div>
      <button type="button" class="btn btn-dark" id="inlineRecoverBtn">रिकवरी कोड से नया PIN बनाएँ</button>
      <p class="muted small">🖼️ <b>कार्ड/image ही खो गया या delete हो गया?</b> चिंता न करें — नीचे <b>“खाता वापसी आवेदन”</b> भेजें। Team Janmat जाँचकर मंज़ूरी देगी, फिर आपके <b>उसी पुराने खाते</b> पर नया PIN लग जाएगा (नया खाता नहीं बनेगा; आपके बनाए चुनाव और वोट सुरक्षित रहेंगे)।</p>
    </div>

    <div id="inlineAppeal" class="recover-box appeal-box" hidden>
      <h4>🙋 Username भूल गए, साझा फ़ोन, या कार्ड खो गया?</h4>
      <p class="muted small">पहले इसी फ़ोन से जुड़े खाते का छिपा संकेत देखिए। फिर भी याद न आए, तो नीचे आवेदन भेजिए — खाता तुरंत नहीं बनेगा; <b>Team Janmat जाँचकर मंज़ूरी देगी</b>, तब तक आवेदन Pending रहेगा।</p>
      <button type="button" class="btn btn-ghost btn-sm" id="inlineHintBtn">इस फ़ोन का username-संकेत देखें</button>
      <div id="inlineHintResult" class="appeal-result" aria-live="polite"></div>

      <label class="auth-label" for="inlineAppealKind">आवेदन की वजह</label>
      <select id="inlineAppealKind" aria-label="आवेदन की वजह">
        <option value="forgot-username">मैं अपना username भूल गया/गई</option>
        <option value="device-second-account">यही फ़ोन परिवार के दूसरे सदस्य का भी है — अलग खाता चाहिए</option>
        <option value="lost-pin-recovery">PIN भी भूल गया/गई और रिकवरी कार्ड (image) भी खो गया — मेरा पुराना खाता वापस चाहिए</option>
      </select>
      <input id="inlineAppealName" type="text" placeholder="आपका असली नाम" maxlength="30" aria-label="आवेदन के लिए नाम" autocomplete="name" />
      <input id="inlineAppealUsername" type="text" placeholder="चाहा गया नया username" maxlength="20" aria-label="चाहा गया username" autocomplete="username" autocapitalize="none" spellcheck="false" />
      <div id="inlineAppealUsernameStatus" class="username-status" aria-live="polite"></div>
      <input id="inlineAppealPin" type="password" inputmode="numeric" placeholder="नया PIN (6–10 अंक) — मंज़ूरी के बाद यही चलेगा" maxlength="10" aria-label="आवेदन का PIN" autocomplete="new-password" />
      <input id="inlineAppealPinConfirm" type="password" inputmode="numeric" placeholder="वही PIN दोबारा" maxlength="10" aria-label="आवेदन PIN दोबारा" autocomplete="new-password" />
      <textarea id="inlineAppealReason" rows="3" maxlength="300" placeholder="कारण साफ़ लिखें — जैसे: पुराना username भूल गया, फ़ोन यही है, पहला खाता 2026 में बना था…" aria-label="आवेदन का कारण"></textarea>
      <button type="button" class="btn btn-dark" id="inlineApplyBtn">Team Janmat को आवेदन भेजें</button>
      <div id="inlineApplyResult" class="appeal-result" aria-live="polite"></div>

      <div class="appeal-status-box">
        <h5>आवेदन की स्थिति देखें</h5>
        <input id="inlineAppId" type="text" placeholder="आवेदन नंबर (जैसे APP-XXXX)" maxlength="24" aria-label="आवेदन नंबर" style="text-transform:uppercase" />
        <input id="inlineAppReceipt" type="text" placeholder="रसीद कोड (अगर है)" maxlength="60" aria-label="आवेदन रसीद" autocomplete="off" />
        <button type="button" class="btn btn-ghost btn-sm" id="inlineAppStatusBtn">स्थिति देखें</button>
        <div id="inlineAppStatusResult" class="appeal-result" aria-live="polite"></div>
      </div>
    </div>

    <p class="login-note" id="inlineAuthNote">अपने username और PIN से लॉगिन करें। सिर्फ़ नाम लिखकर अब कोई किसी के खाते में नहीं जा सकता।</p>
    <p class="login-note thin">एक जैसे नाम के कई लोग हो सकते हैं, लेकिन username पूरी Janmat में सिर्फ़ एक व्यक्ति का होता है। अगर @pawan_verma किसी ने ले लिया, तो दूसरा वही username नहीं बना सकता।</p>
    <p class="login-note thin">🔒 एक फ़ोन पर सीधे एक ही खाता बनेगा। परिवार के दूसरे सदस्य के लिए ऊपर वाले आवेदन से Team Janmat की मंज़ूरी लेनी होगी।</p>
    <p class="login-note thin">आगे बढ़ने पर आप <a href="#/disclaimer">डिस्क्लेमर व नियम</a> स्वीकार करते हैं।</p>
  </div>`;
}

function bindLoginCard(onDone) {
  const form = document.getElementById('inlineLoginForm');
  const appealBox = document.getElementById('inlineAppeal');
  const openAppeal = () => {
    if (!appealBox) return;
    appealBox.hidden = false;
    appealBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const hb = document.getElementById('inlineHintBtn');
    if (hb) setTimeout(() => hb.focus(), 250);
  };
  ['useSavedName', 'showSavedUsernameHint'].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.addEventListener('click', openAppeal);
  });
  if (!form) return;

  const byId = (id) => document.getElementById(id);
  const loginUsername = byId('inlineUsernameLogin');
  const loginPin = byId('inlinePinLogin');
  const regName = byId('inlineName');
  const regUsername = byId('inlineUsername');
  const regUsernameStatus = byId('inlineUsernameStatus');
  const regPin = byId('inlinePassword');
  const regPin2 = byId('inlinePasswordConfirm');
  const oldName = byId('inlineOldName');
  const oldPassword = byId('inlineOldPassword');
  const oldUsername = byId('inlineOldUsername');
  const oldUsernameStatus = byId('inlineOldUsernameStatus');
  const oldPin = byId('inlineOldPin');
  const oldPin2 = byId('inlineOldPinConfirm');
  const btn = byId('inlineLoginBtn');
  const note = byId('inlineAuthNote');
  let mode = 'login';

  /* ❗ गलती का कारण form के अंदर स्थायी लाल box में — toast उड़ जाने के बाद भी
     उपयोगकर्ता पढ़ सके कि login/PIN क्यों नहीं बना। */
  const showAuthError = (msg, id, scroll) => {
    const el = byId(id || 'inlineAuthError');
    if (!el) return;
    el.textContent = '⚠ ' + msg;
    el.hidden = false;
    if (scroll !== false) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {} }
  };
  const clearAuthErrors = () => {
    ['inlineAuthError', 'inlineRecoverError'].forEach((id) => {
      const el = byId(id);
      if (el) { el.hidden = true; el.textContent = ''; }
    });
  };

  const restrictPin = (el) => {
    if (!el) return;
    el.addEventListener('input', () => { el.value = String(el.value).replace(/[^0-9]/g, '').slice(0, 10); });
  };
  [regPin, regPin2, oldPin, oldPin2, byId('inlineNewPassword'), byId('inlineNewPasswordConfirm'), byId('inlineAppealPin'), byId('inlineAppealPinConfirm')].forEach(restrictPin);
  /* पुराने बने username-खातों में पुराना अक्षर-पासवर्ड रह सकता है इसलिए login field पर सिर्फ़-अंक रोक नहीं लगाते। */

  bindUsernameAvailability(regUsername, regUsernameStatus);
  bindUsernameAvailability(oldUsername, oldUsernameStatus);
  bindUsernameAvailability(byId('inlineAppealUsername'), byId('inlineAppealUsernameStatus'));

  const ensureAvailable = async (input, status) => {
    const u = normalizeUsernameClient(input.value);
    input.value = u;
    const err = usernameErrorClient(u);
    if (err) throw new Error(err);
    if (input.dataset.usernameState === 'taken') {
      throw new Error('यह username (@' + u + ') पहले से उपयोग में है — कोई दूसरा चुनें।');
    }
    if (input.dataset.usernameState !== 'available') {
      const chk = await checkUsernameNow(input, status);
      if (chk && chk.available === false) throw new Error(chk.error || 'यह username पहले से उपयोग में है।');
    }
    return u;
  };

  const checkPinPair = (pinEl, pin2El, username) => {
    const pin = pinEl.value;
    const err = pinErrorClient(pin, username);
    if (err) throw new Error(err);
    if (pin !== pin2El.value) throw new Error('दोनों PIN एक जैसे नहीं हैं — फिर से ध्यान से लिखें।');
    return pin;
  };

  const setMode = (m) => {
    clearAuthErrors();
    mode = (m === 'register' || m === 'old') ? m : 'login';
    $$('.auth-tab', form).forEach((b) => b.classList.toggle('active', b.dataset.authMode === mode));
    byId('authLoginFields').hidden = mode !== 'login';
    byId('authRegisterFields').hidden = mode !== 'register';
    byId('authOldFields').hidden = mode !== 'old';
    btn.textContent = mode === 'register'
      ? 'मेरा नया खाता बनाएँ'
      : mode === 'old'
        ? 'पुराने खाते में Username लगाएँ'
        : 'लॉगिन करें';
    if (note) note.textContent = mode === 'register'
      ? 'नया खाता: असली नाम प्रोफ़ाइल के लिए है; username आपकी एकमात्र login-ID होगी और PIN उसकी चाबी। एक फ़ोन पर सीधे एक ही खाता बनेगा।'
      : mode === 'old'
        ? 'पुराना खाता: नाम ठीक वही लिखें जो पहले चलता था। पासवर्ड बनाया था तो वह भी लगेगा; बिना-पासवर्ड पुराना खाता सिर्फ़ अपने जुड़े फ़ोन से मिलेगा।'
        : 'अपने username और PIN से लॉगिन करें। सिर्फ़ नाम लिखकर अब कोई किसी के खाते में नहीं जा सकता।';
    const focusEl = mode === 'register' ? regName : mode === 'old' ? oldName : loginUsername;
    if (focusEl) setTimeout(() => focusEl.focus(), 30);
  };
  $$('.auth-tab', form).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.authMode)));

  const forgot = byId('inlineForgot');
  const recBox = byId('inlineRecover');
  if (forgot && recBox) forgot.addEventListener('click', () => {
    recBox.hidden = !recBox.hidden;
    if (!recBox.hidden) {
      const ru = byId('inlineRecoverUsername');
      if (ru && !ru.value && loginUsername) ru.value = normalizeUsernameClient(loginUsername.value);
      const c = byId('inlineRecoveryCode');
      if (c) c.focus();
    }
  });
  const recBtn = byId('inlineRecoverBtn');
  if (recBtn) recBtn.addEventListener('click', async () => {
    clearAuthErrors();
    recBtn.disabled = true;
    recBtn.textContent = 'जाँच रहे हैं…';
    try {
      const username = normalizeUsernameClient(byId('inlineRecoverUsername').value);
      const uErr = usernameErrorClient(username);
      if (uErr) throw new Error(uErr);
      const code = byId('inlineRecoveryCode').value.trim();
      if (!code) throw new Error('कारण: रिकवरी कोड लिखा ही नहीं। लॉगिन कार्ड पर लिखा गुप्त कोड यहाँ लिखें।');
      const codeNorm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (codeNorm.length !== 12) throw new Error('कारण: रिकवरी कोड अधूरा है — कोड कुल 12 अक्षरों का होता है (जैसे ABCD-EFGH-JKLM), आपने ' + codeNorm.length + ' अक्षर लिखे हैं। कार्ड देखकर पूरा कोड लिखें।');
      const newPw = checkPinPair(byId('inlineNewPassword'), byId('inlineNewPasswordConfirm'), username);
      const res = await recoverWithCode(username, code, newPw);
      toast('नया PIN बन गया — स्वागत है, ' + res.user.name + ' (@' + res.user.username + ')! आपका रिकवरी कोड वही पुराना ही रहेगा — वही कार्ड सँभालकर रखें।', 'ok');
      if (onDone) onDone();
    } catch (e) {
      toast(e.message, 'err');
      showAuthError(e.message, 'inlineRecoverError');
      if (e.code === 'RECOVERY_NOT_SET') {
        const k = byId('inlineAppealKind');
        if (k) { k.value = 'lost-pin-recovery'; k.dispatchEvent(new Event('change')); }
        openAppeal();
      }
    }
    recBtn.disabled = false;
    recBtn.textContent = 'रिकवरी कोड से नया PIN बनाएँ';
  });

  const forgotUsername = byId('inlineForgotUsername');
  if (forgotUsername && appealBox) forgotUsername.addEventListener('click', () => {
    appealBox.hidden = !appealBox.hidden;
    if (!appealBox.hidden) appealBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  try {
    const savedApp = JSON.parse(store.get('jm_application') || 'null');
    if (savedApp && savedApp.applicationId) {
      byId('inlineAppId').value = savedApp.applicationId;
      if (savedApp.receipt) byId('inlineAppReceipt').value = savedApp.receipt;
      byId('inlineAppStatusResult').innerHTML = '📌 आपका पिछला आवेदन <b>' + esc(savedApp.applicationId) + '</b> इस फ़ोन पर याद है — “स्थिति देखें” दबाकर जाँच लें।';
    }
  } catch (_) {}

  const hintBtn = byId('inlineHintBtn');
  if (hintBtn) hintBtn.addEventListener('click', async () => {
    hintBtn.disabled = true;
    hintBtn.textContent = 'देख रहे हैं…';
    const out = byId('inlineHintResult');
    try {
      const res = await api('/api/auth/username-hint', { method: 'POST', body: { deviceId: DEVICE_ID } });
      if (res.ok && Array.isArray(res.hints) && res.hints.length) {
        out.innerHTML = 'इस फ़ोन से जुड़े खाते:<br>' + res.hints.map((h) => '• <b>' + esc(h.name) + '</b> — username <b>' + esc(h.usernameMasked) + '</b>').join('<br>')
          + '<br><span class="muted small">पूरा username लॉगिन कार्ड पर लिखा होता है। सुरक्षा के लिए यहाँ पूरा नहीं दिखता।</span>';
      } else {
        out.textContent = res.message || 'इस फ़ोन से कोई खाता जुड़ा नहीं मिला।';
      }
    } catch (e) {
      out.textContent = e.message;
    }
    hintBtn.disabled = false;
    hintBtn.textContent = 'इस फ़ोन का username-संकेत देखें';
  });

  const appealKindSel = byId('inlineAppealKind');
  if (appealKindSel) appealKindSel.addEventListener('change', () => {
    const unameInput = byId('inlineAppealUsername');
    const status = byId('inlineAppealUsernameStatus');
    const lost = appealKindSel.value === 'lost-pin-recovery';
    if (unameInput) {
      unameInput.dataset.skipAvailability = lost ? '1' : '0';
      unameInput.placeholder = lost ? 'आपका पुराना username (जिसका खाता वापस चाहिए)' : 'चाहा गया नया username';
      delete unameInput.dataset.usernameState;
    }
    if (status) status.innerHTML = lost
      ? '<span class="u-wait">खाता-वापसी: अपना मौजूदा (पुराना) username लिखें। मंज़ूरी के बाद उसी खाते पर नया PIN लगेगा — नया खाता नहीं बनेगा।</span>'
      : '';
    if (!lost && unameInput && unameInput.value) checkUsernameNow(unameInput, status);
  });

  const applyBtn = byId('inlineApplyBtn');
  if (applyBtn) applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.textContent = 'आवेदन भेज रहे हैं…';
    const out = byId('inlineApplyResult');
    try {
      const name = byId('inlineAppealName').value.trim();
      if (name.length < 2) throw new Error('अपना असली नाम लिखें।');
      let username;
      if (byId('inlineAppealKind').value === 'lost-pin-recovery') {
        /* खाता-वापसी में username "खाली" नहीं, अपना मौजूद पुराना username चाहिए */
        username = normalizeUsernameClient(byId('inlineAppealUsername').value);
        byId('inlineAppealUsername').value = username;
        const uErr2 = usernameErrorClient(username);
        if (uErr2) throw new Error(uErr2);
      } else {
        username = await ensureAvailable(byId('inlineAppealUsername'), byId('inlineAppealUsernameStatus'));
      }
      const pin = checkPinPair(byId('inlineAppealPin'), byId('inlineAppealPinConfirm'), username);
      const reason = byId('inlineAppealReason').value.trim();
      if (reason.length < 8) throw new Error('कारण थोड़ा साफ़ लिखें (कम से कम 8 अक्षर)।');
      const res = await api('/api/auth/apply', {
        method: 'POST',
        body: { kind: byId('inlineAppealKind').value, name, username, password: pin, reason, deviceId: DEVICE_ID },
      });
      store.set('jm_application', JSON.stringify({ applicationId: res.applicationId, receipt: res.receipt, username, at: Date.now() }));
      byId('inlineAppId').value = res.applicationId;
      byId('inlineAppReceipt').value = res.receipt;
      const receiptText = [
        'A2Z Janmat — खाता आवेदन रसीद',
        'आवेदन नंबर: ' + res.applicationId,
        'नाम: ' + name,
        'चाहा गया username: @' + username,
        'रसीद कोड: ' + res.receipt,
        'गुप्त रिकवरी कोड: ' + res.recoveryCode,
        '',
        'PIN आपने खुद चुना था — सुरक्षा के लिए यहाँ नहीं लिखा है।',
        'खाता अभी Pending है। Team Janmat की मंज़ूरी के बाद इसी username + PIN से लॉगिन होगा।',
        'रिकवरी कोड किसी को न दें।',
      ].join('\n');
      out.innerHTML = `<div class="recovery-show">
        <b>✅ आवेदन मिल गया — अभी Pending है</b>
        <span>आवेदन नंबर: <b>${esc(res.applicationId)}</b><br>Username: <b>@${esc(username)}</b></span>
        <span>रसीद कोड:</span><code>${esc(res.receipt)}</code>
        <span>🔑 गुप्त रिकवरी कोड (मंज़ूरी के बाद काम आएगा):</span><code>${esc(res.recoveryCode)}</code>
        <span>${esc(res.message || 'Team Janmat जाँच करेगी।')}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="downloadApplicationReceipt">रसीद डाउनलोड करें</button>
      </div>`;
      const dl = byId('downloadApplicationReceipt');
      if (dl) dl.addEventListener('click', () => downloadFile('janmat-application-' + res.applicationId + '.txt', receiptText, 'text/plain;charset=utf-8'));
      toast('आवेदन Team Janmat के पास Pending है। रसीद और रिकवरी कोड सँभाल लें।', 'ok');
    } catch (e) {
      toast(e.message, 'err');
      if (out) out.textContent = '❌ ' + e.message;
      if (e.code === 'USERNAME_TAKEN') checkUsernameNow(byId('inlineAppealUsername'), byId('inlineAppealUsernameStatus'));
      if (e.data && e.data.applicationId) {
        byId('inlineAppId').value = e.data.applicationId;
      }
    }
    applyBtn.disabled = false;
    applyBtn.textContent = 'Team Janmat को आवेदन भेजें';
  });

  const statusBtn = byId('inlineAppStatusBtn');
  if (statusBtn) statusBtn.addEventListener('click', async () => {
    statusBtn.disabled = true;
    statusBtn.textContent = 'देख रहे हैं…';
    const out = byId('inlineAppStatusResult');
    try {
      const res = await api('/api/auth/application-status', {
        method: 'POST',
        body: { applicationId: byId('inlineAppId').value.trim(), receipt: byId('inlineAppReceipt').value.trim(), deviceId: DEVICE_ID },
      });
      const label = res.status === 'approved' ? '✅ मंज़ूर' : res.status === 'rejected' ? '❌ अस्वीकृत' : res.status === 'expired' ? '⌛ समाप्त' : '⏳ Pending (जाँच में)';
      out.innerHTML = '<b>' + esc(res.applicationId) + ' — ' + label + '</b><br>' + esc(res.message || '')
        + (res.decisionNote ? '<br><span class="muted small">Team Janmat: ' + esc(res.decisionNote) + '</span>' : '');
      if (res.status === 'approved') {
        setMode('login');
        loginUsername.value = res.username || '';
        setTimeout(() => loginPin.focus(), 200);
      }
    } catch (e) {
      out.textContent = e.message;
    }
    statusBtn.disabled = false;
    statusBtn.textContent = 'स्थिति देखें';
  });

  if (loginUsername) loginUsername.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearAuthErrors();
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = mode === 'register' ? 'खाता बना रहे हैं…' : mode === 'old' ? 'पुराना खाता जोड़ रहे हैं…' : 'लॉगिन…';
    try {
      let res;
      if (mode === 'register') {
        const name = regName.value.trim();
        if (name.length < 2) throw new Error('अपना असली नाम लिखें।');
        const username = await ensureAvailable(regUsername, regUsernameStatus);
        const pin = checkPinPair(regPin, regPin2, username);
        res = await registerWithCredentials(name, username, pin);
        toast((res.claimed ? 'आपके पुराने खाते पर username लग गया — ' : 'खाता बन गया — ') + 'स्वागत है, ' + res.user.name + ' (@' + res.user.username + ')! कार्ड सँभाल लें।', 'ok');
        if (res.sameNameExists) {
          setTimeout(() => toast('इसी नाम के अन्य लोग भी हो सकते हैं — आपका username सिर्फ़ आपका है।', 'ok'), 1400);
        }
      } else if (mode === 'old') {
        const name = oldName.value.trim();
        if (name.length < 2) throw new Error('पुराना नाम ठीक वैसा ही लिखें जैसा पहले चलता था।');
        const username = await ensureAvailable(oldUsername, oldUsernameStatus);
        const pin = checkPinPair(oldPin, oldPin2, username);
        res = await migrateOldAccount({ name, oldPassword: oldPassword.value, username, password: pin });
        toast('पुराना खाता मिल गया! अब आपका username @' + res.user.username + ' है — नया कार्ड सँभाल लें।', 'ok');
      } else {
        const username = normalizeUsernameClient(loginUsername.value);
        loginUsername.value = username;
        const uErr = usernameErrorClient(username);
        if (uErr) throw new Error(uErr);
        if (!loginPin.value) throw new Error('अपना PIN लिखें।');
        res = await loginWithCredentials(username, loginPin.value);
        toast('स्वागत है, ' + res.user.name + (res.user.username ? ' (@' + res.user.username + ')' : '') + '!', 'ok');
      }
      if (onDone) onDone();
    } catch (e) {
      toast(e.message, 'err');
      if (e.code === 'USERNAME_TAKEN') {
        if (mode === 'register') checkUsernameNow(regUsername, regUsernameStatus);
        else if (mode === 'old') checkUsernameNow(oldUsername, oldUsernameStatus);
      } else if (e.code === 'ACCOUNT_NOT_FOUND') {
        setMode('register');
        if (loginUsername.value) { regUsername.value = loginUsername.value; checkUsernameNow(regUsername, regUsernameStatus); }
      } else if (e.code === 'DEVICE_HAS_ACCOUNT') {
        openAppeal();
        const kind = byId('inlineAppealKind');
        if (kind) kind.value = 'device-second-account';
        if (regName.value) byId('inlineAppealName').value = regName.value;
        if (regUsername.value) byId('inlineAppealUsername').value = regUsername.value;
      } else if (e.code === 'ACCOUNT_PENDING') {
        openAppeal();
      }
      /* कारण form के अंदर स्थायी रूप से भी दिखे — toast उड़ जाने के बाद भी पढ़ सके */
      showAuthError(e.message, 'inlineAuthError', !(e.code === 'DEVICE_HAS_ACCOUNT' || e.code === 'ACCOUNT_PENDING'));
    }
    btn.disabled = false;
    btn.textContent = mode === 'register'
      ? 'मेरा नया खाता बनाएँ'
      : mode === 'old'
        ? 'पुराने खाते में Username लगाएँ'
        : 'लॉगिन करें';
    if (!btn.textContent) btn.textContent = originalText;
  });
}

/* चल रहे चुनाव हर सार्वजनिक सूची में सबसे ऊपर रहेंगे। चलते चुनावों में
   समाप्ति के सबसे नज़दीक वाला पहले; “new” क्रम में नया पहले। समाप्त
   चुनावों में ही वोटों के आधार पर क्रम लग सकता है, क्योंकि चलते चुनाव
   की कुल संख्या सार्वजनिक नहीं है। */
function sortElectionsLiveFirst(items, mode = 'live') {
  return (items || []).slice().sort((a, b) => {
    const rankDiff = (a && a.closed ? 1 : 0) - (b && b.closed ? 1 : 0);
    if (rankDiff) return rankDiff;
    if (mode === 'votes' && a.closed && b.closed) {
      const diff = (Number(b.totalVotes) || 0) - (Number(a.totalVotes) || 0);
      if (diff) return diff;
    }
    if (mode !== 'new' && !a.closed && !b.closed) {
      const ae = Number(a.endsAt) > 0 ? Number(a.endsAt) : Number.POSITIVE_INFINITY;
      const be = Number(b.endsAt) > 0 ? Number(b.endsAt) : Number.POSITIVE_INFINITY;
      if (ae !== be) return ae - be;
    }
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  });
}

function electionCard(e) {
  const statusBadge = e.closed
    ? '<span class="badge closed">परिणाम घोषित</span>'
    : '<span class="badge live"><i></i> मतदान चालू</span>';
  const syms = (e.symbols || []).slice(0, 5)
    .map((s) => `<span class="sym-chip" title="${esc(symbolName(s))}">${symbolSVG(s, 18)}</span>`).join('');
  return `
  <article class="ecard fade-up">
    <div class="ecard-body">
      <div class="ecard-top">
        ${statusBadge}
        <span class="badge">${esc(e.type)}</span>
        ${e.demo ? '<span class="badge demo">डेमो</span>' : ''}
      </div>
      <h3>${esc(e.title)}</h3>
      <div class="ecard-loc">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z"/><circle cx="12" cy="10" r="3"/></svg>
        ${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)}
      </div>
      <div class="sym-row">${syms}</div>
      ${e.endsAt && !e.closed ? `<div class="ecard-timer">⏳ <b data-left="${e.remainingMs || 0}">${esc(fmtLeft(e.remainingMs || 0))}</b></div>` : ''}
    </div>
    <div class="ecard-foot">
      <div class="ecard-votes">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg>
        ${e.closed ? `<b>${fmt(e.totalVotes)}</b> वोट` : '<b>🔒</b> वोट संख्या छिपी'} · ${e.candidateCount} उम्मीदवार
      </div>
      <a class="btn btn-primary btn-sm" href="#/e/${e.code}">${e.closed ? 'परिणाम देखें' : 'वोट करें'}</a>
    </div>
  </article>`;
}

const HOW_SECTION = `
<section class="section" id="how">
  <div class="wrap">
    <div class="section-head">
      <div>
        <div class="kicker">बस 3 कदम</div>
        <h2>कैसे काम करता है?</h2>
        <p>Username से लॉगिन कीजिए, चुनाव बनाइए या किसी के चुनाव में वोट दीजिए — बाकी सब अपने आप।</p>
      </div>
    </div>
    <div class="how-grid">
      <div class="how-card">
        <div class="how-num">1</div>
        <h3>Username से लॉगिन</h3>
        <p>नाम + अपना गुप्त पासवर्ड रखिए — मोबाइल/OTP/Gmail नहीं लगता। अब वही नाम लिखकर कोई और आपके खाते में नहीं जा सकता।</p>
      </div>
      <div class="how-card">
        <div class="how-num">2</div>
        <h3>चुनाव बनाइए / वोट दीजिए</h3>
        <p>प्रकार, गाँव, ज़िला और राज्य चुनकर अपना चुनाव बनाइए — या किसी भी सार्वजनिक चुनाव में अपना वोट दर्ज कीजिए।</p>
      </div>
      <div class="how-card">
        <div class="how-num">3</div>
        <h3>परिणाम मतदान के बाद</h3>
        <p>मतदान के दौरान उम्मीदवारों की गिनती छिपी रहती है। समय खत्म होते ही अंतिम परिणाम सभी को दिखता है।</p>
      </div>
    </div>
  </div>
</section>`;

const HERO = `
<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <span class="eyebrow"><i class="dot"></i> दुनिया में कहीं से भी वोट करें</span>
      <h1>अपने गाँव का <span class="hl">चुनाव</span>,<br/>अब ऑनलाइन।</h1>
      <p class="hero-sub">
        सरपंच, प्रधान, मुखिया, अध्यक्ष या विधायक — अपना चुनाव बनाइए, गाँव, ज़िला और राज्य चुनिए,
        और एक लिंक से दुनिया के किसी भी कोने से मतदान करवाइए। Username से लॉगिन, एक डिवाइस से एक वोट, परिणाम मतदान समाप्त होने पर घोषित।
      </p>
      <div class="hero-actions">
        <a class="btn btn-saffron btn-lg" href="#/create">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          अपना चुनाव बनाएँ
        </a>
        <a class="btn btn-ghost btn-lg" href="#/explore">चुनाव खोजें</a>
      </div>
      <div class="hero-trust">
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg> Username + PIN लॉगिन</span>
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg> परिणाम मतदान के बाद</span>
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg> एक डिवाइस, एक वोट</span>
      </div>
    </div>

    <!-- hero ka visual: NAKLI data nahi — ya to asli chunav dikhta hai,
         ya "3 aasan kadam" wala neutral card (heroVisualHTML se bharta hai) -->
    <div class="hero-visual" id="heroVisual" aria-hidden="true"></div>
  </div>
</section>`;

/* =====================================================================
   Hero ka visual — 100% imaandaar
   ---------------------------------------------------------------------
   • Agar koi ASLI chunav hai → usi ka card dikhta hai (asli naam, asli vote)
   • Agar ek bhi chunav nahi hai → "3 aasan kadam" card (koi jhoota naam,
     number ya "36 vote" jaisa nakli data nahi)
   ===================================================================== */

function heroStepsHTML() {
  const step = (n, title, desc) => `
    <div class="hstep">
      <span class="hstep-n">${n}</span>
      <div><b>${title}</b><span>${desc}</span></div>
    </div>`;
  return `
  <div class="ballot ballot-hero">
    <div class="ballot-head">
      <div class="ballot-title">जनमत कैसे काम करता है</div>
      <span class="ballot-live off"><i></i> नया</span>
    </div>
    ${step(1, 'Username + PIN से खाता बनाइए', 'मोबाइल/Gmail/OTP नहीं — username आपकी स्थायी ID और PIN उसकी चाबी है')}
    ${step(2, 'उम्मीदवार जोड़िए', 'चुनाव चिन्ह के साथ — 2 मिनट में तैयार')}
    ${step(3, 'लिंक भेजिए या खोजिए', 'जो भी जहाँ भी हो, वोट कर सकेगा')}
    <div class="ballot-foot"><span>एक डिवाइस = एक वोट</span><span>परिणाम अंत में</span></div>
  </div>`;
}

function heroElectionHTML(e, detail) {
  const closed = detail ? !!detail.closed : !!e.closed;
  const hidden = !closed;
  const resultRows = detail && detail.results && Array.isArray(detail.results.candidates)
    ? detail.results.candidates : [];
  const rank = new Map(resultRows.map((r, i) => [r.id, i]));
  let rows = (detail && detail.candidates ? detail.candidates : []).slice();
  if (!hidden && rank.size) {
    rows.sort((x, y) => (rank.get(x.id) ?? 999) - (rank.get(y.id) ?? 999));
  }
  rows = rows.slice(0, 3);
  const winnerIds = !hidden && detail && detail.results && Array.isArray(detail.results.winnerIds)
    ? detail.results.winnerIds : [];

  const body = rows.length
    ? rows.map((c) => {
        const stat = resultRows.find((r) => r.id === c.id) || {};
        const pct = hidden ? 0 : (Number(stat.percent) || 0);
        const picked = winnerIds.includes(c.id);
        return `
        <div class="ballot-row${picked ? ' picked' : ''}">
          <div class="ballot-sym" data-sym="${esc(c.symbol || 'diya')}"></div>
          <div class="ballot-info">
            <div class="ballot-name">${esc(c.name)}</div>
            <div class="ballot-party">${esc(c.party || 'निर्दलीय')}</div>
            ${hidden ? '' : `<div class="ballot-bar"><i style="width:${pct}%"></i></div>`}
          </div>
          <div class="ballot-check">${picked ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>' : ''}</div>
        </div>`;
      }).join('')
    : `<div class="ballot-row"><div class="ballot-info"><div class="ballot-name">${esc(e.title)}</div>
         <div class="ballot-party">${esc(e.candidateCount || 0)} उम्मीदवार</div></div></div>`;

  return `
  <div class="ballot ballot-hero">
    <div class="ballot-head">
      <div class="ballot-title">${esc(e.title)}</div>
      <span class="ballot-live${closed ? ' off' : ''}"><i></i> ${closed ? 'समाप्त' : 'मतदान चालू'}</span>
    </div>
    ${body}
    <div class="ballot-foot">
      <span>${closed ? fmt((detail && detail.totalVotes) || e.totalVotes || 0) + ' वोट पड़े' : 'वोट संख्या छिपी'}</span>
      <span>${hidden ? 'उम्मीदवारों की गिनती छिपी' : esc([e.gram, e.district].filter(Boolean).join(', '))}</span>
    </div>
  </div>`;
}

async function fillHeroVisual(elections) {
  const box = document.getElementById('heroVisual');
  if (!box) return;

  const ordered = sortElectionsLiveFirst(elections || []);
  const live = ordered[0];
  if (!live) {
    box.innerHTML = `
      <div class="floaty tl">
        <div class="floaty-ico"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0fa968" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
        <div>कोई डेमो नहीं<small>सिर्फ़ असली चुनाव</small></div>
      </div>
      ${heroStepsHTML()}`;
    fillSymbolSlots(box);
    return;
  }

  box.innerHTML = `
    <div class="floaty tl">
      <div class="floaty-ico"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0fa968" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
      <div>अभी लाइव चुनाव<small>${esc(live.gram || live.title)}</small></div>
    </div>
    ${heroElectionHTML(live, null)}`;
  fillSymbolSlots(box);

  // asli ummeedwar ke naam lane ke liye ek detail call (chunav hone par hi)
  try {
    const detail = await api('/api/elections/' + encodeURIComponent(live.code));
    const stillThere = document.getElementById('heroVisual');
    if (stillThere && detail) {
      stillThere.innerHTML = `
        <div class="floaty tl">
          <div class="floaty-ico"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0fa968" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
          <div>अभी लाइव चुनाव<small>${esc(live.gram || live.title)}</small></div>
        </div>
        ${heroElectionHTML(live, detail)}`;
      fillSymbolSlots(stillThere);
    }
  } catch (_) { /* summary card hi rehne do */ }
}

function fillSymbolSlots(root) {
  (root || document).querySelectorAll('[data-sym]').forEach((el) => {
    if (!el.dataset.filled) {
      el.innerHTML = symbolSVG(el.dataset.sym, 22);
      el.dataset.filled = '1';
    }
  });
}

/* =====================================================================
   HOME
   ===================================================================== */

/* =====================================================================
   खाली — लेकिन ज़िंदा — स्थिति
   ---------------------------------------------------------------------
   यहाँ कोई डेमो/नक़ली चुनाव नहीं दिखाया जाता (user ki demand: "no demo,
   no fake"). जब डेटाबेस सच में खाली हो, तो आदमी को साफ़-साफ़ बताया जाता
   है कि मंच नया है, कुछ टूटा नहीं है, और पहला चुनाव वही बना सकता है।
   ===================================================================== */
function emptyLiveHTML(opts) {
  const preview = !!window.JANMAT_OFFLINE;
  const onHome = !!(opts && opts.onHome);

  if (preview) {
    return `
    <div class="empty empty-live" style="grid-column:1/-1">
      <div class="em-ico">${ICON.warn}</div>
      <h3>यह डेमो प्रीव्यू है — साझा सर्वर से नहीं जुड़ा</h3>
      <p>इस पेज में जो चुनाव आप बनाएँगे वह <b>सिर्फ़ इसी ब्राउज़र</b> में रहेगा — दूसरों को नहीं दिखेगा।
      असली साझा मतदान (एक लिंक/खोज से सबको दिखे) के लिए साइट को सर्वर से जोड़ना ज़रूरी है।</p>
      <div class="empty-actions">
        <a class="btn btn-primary" href="#/how">कैसे पूरा चालू करें</a>
      </div>
    </div>`;
  }

  return `
  <div class="empty empty-live" style="grid-column:1/-1">
    <div class="em-ico">${ICON.box}</div>
    <h3>यहाँ अभी कोई चुनाव नहीं है — पहला चुनाव आप बनाइए</h3>
    <p>
      जनमत एक नया सामुदायिक मंच है और यहाँ <b>कोई नक़ली या डेमो चुनाव नहीं</b> रखा जाता।
      जो चुनाव असली लोग बनाएँगे, वही इस पेज पर सबको दिखेगा — लिंक भेजने की ज़रूरत नहीं,
      लोग सीधे खोजकर भी उस तक पहुँच जाएँगे।
    </p>
    <ol class="empty-steps">
      <li><b>चुनाव बनाइए</b> — गाँव/कॉलोनी का नाम, ज़िला, उम्मीदवार (2 मिनट)</li>
      <li><b>कोड मिलेगा</b> — जैसे <code>7K2M9Q</code>; वही लोगों को भेजिए या यहीं खोजिए</li>
      <li><b>सब वोट करेंगे</b> — एक डिवाइस = एक वोट, परिणाम मतदान समाप्त होने पर</li>
    </ol>
    <div class="empty-actions">
      <a class="btn btn-primary" href="#/create">अपना चुनाव बनाएँ →</a>
      <a class="btn btn-ghost" href="#/how">कैसे काम करता है</a>
    </div>
  </div>`;
}

/* "कोड से चुनाव खोलें" box (होम पर) — खोजकर आने वालों के लिए */
function bindOpenByCode() {
  const form = document.getElementById('openByCode');
  const input = document.getElementById('openCode');
  if (!form || !input) return;
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const code = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 5) { toast('चुनाव कोड 6 अक्षरों का होता है।', 'err'); input.focus(); return; }
    location.hash = '#/e/' + encodeURIComponent(code);
  });
}

async function renderHome() {
  setActiveNav('home');
  clearPoll();
  app.innerHTML = HERO + `
  <section class="section tight">
    <div class="wrap">
      <div class="section-head">
        <div>
          <div class="kicker">लाइव चुनाव</div>
          <h2>हाल में बने चुनाव</h2>
          <p>चल रहे चुनाव सबसे ऊपर हैं — किसी भी चुनाव पर जाकर वोट कीजिए या अपना नया चुनाव शुरू कीजिए।</p>
        </div>
        <div class="open-by-code">
          <form id="openByCode" autocomplete="off">
            <input id="openCode" type="text" placeholder="चुनाव कोड डालें (जैसे 7K2M9Q)" maxlength="12"
                   inputmode="latin" aria-label="चुनाव कोड" style="text-transform:uppercase" />
            <button class="btn btn-primary btn-sm" type="submit">खोलें</button>
          </form>
          <a class="btn btn-ghost btn-sm" href="#/explore">सारे चुनाव देखें →</a>
        </div>
      </div>
      <div class="grid-cards" id="recentList">
        ${'<div class="ecard"><div class="ecard-body"><div class="skeleton" style="height:14px;width:40%"></div><div class="skeleton" style="height:20px;width:80%;margin-top:12px"></div><div class="skeleton" style="height:14px;width:60%;margin-top:10px"></div></div></div>'.repeat(3)}
      </div>
    </div>
  </section>

  ${HOW_SECTION}

  <section class="section tight">
    <div class="wrap">
      <div class="panel cta-panel">
        <h2>आपके गाँव का फैसला, अब आपके हाथ में।</h2>
        <p>चुनाव बनाना बिलकुल मुफ़्त है — username से लॉगिन कीजिए और दो मिनट में चुनाव तैयार।</p>
        <a class="btn btn-saffron btn-lg" href="#/create">अभी चुनाव बनाएँ →</a>
        <p class="cta-legal">यह मंच सिर्फ़ सामुदायिक/निजी मतदान के लिए है। किसी सरकारी या निर्वाचन-आयोग चुनाव से इसका कोई संबंध नहीं है। <a href="#/disclaimer">पूरा डिस्क्लेमर</a></p>
      </div>
    </div>
  </section>`;

  fillSymbolSlots(app);
  bindOpenByCode();
  fillHeroVisual(null);   // turant neutral card (khali jagah na dikhe)

  try {
    const list = await api('/api/elections');
    const orderedElections = sortElectionsLiveFirst(list.elections);
    fillHeroVisual(orderedElections);
    const box = document.getElementById('recentList');
    if (box) {
      box.innerHTML = orderedElections.length
        ? orderedElections.slice(0, 6).map(electionCard).join('')
        : emptyLiveHTML({ onHome: true });
    }
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* =====================================================================
   EXPLORE
   ===================================================================== */

let exploreCache = null;

async function renderExplore() {
  setActiveNav('explore');
  clearPoll();
  app.innerHTML = `
  <section class="section">
    <div class="wrap">
      <div class="kicker">सारे चुनाव</div>
      <h2 style="font-size:clamp(26px,3.4vw,36px);letter-spacing:-.025em">चुनाव खोजें</h2>
      <p class="muted" style="margin:8px 0 14px;max-width:44em">गाँव, ज़िला, राज्य, चुनाव कोड या नाम से खोजिए और वोट कीजिए।</p>
      <div style="margin:0 0 22px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span class="badge">कुल चुनाव: <b id="exploreTotalElections">—</b></span>
        <span class="muted small">चल रहे चुनाव सबसे ऊपर दिखते हैं</span>
      </div>

      <div class="filters">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="q" type="search" placeholder="जैसे: नीमगाँव, अलवर, सरपंच…" autocomplete="off" />
        </div>
        <select id="stateFilter" aria-label="राज्य चुनें"><option value="">सभी राज्य</option></select>
        <select id="sortBy" aria-label="क्रम">
          <option value="live">लाइव पहले · समाप्ति नज़दीक पहले</option>
          <option value="new">लाइव पहले · नए पहले</option>
          <option value="votes">समाप्त चुनावों में ज़्यादा वोट पहले</option>
        </select>
      </div>

      <div class="grid-cards" id="list"></div>
      <div id="emptyBox"></div>
    </div>
  </section>`;

  const listBox = document.getElementById('list');
  listBox.innerHTML = '<div class="skeleton" style="height:180px;border-radius:18px"></div>'.repeat(3);

  try {
    if (!exploreCache) exploreCache = await api('/api/elections');
    const totalEl = document.getElementById('exploreTotalElections');
    if (totalEl) totalEl.textContent = fmt(exploreCache.totalElections != null ? exploreCache.totalElections : exploreCache.elections.length);
    const stateSel = document.getElementById('stateFilter');
    exploreCache.states.forEach((s) => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      stateSel.appendChild(o);
    });

    const draw = () => {
      const q = (document.getElementById('q').value || '').trim().toLowerCase();
      const st = stateSel.value;
      const sort = document.getElementById('sortBy').value;
      let items = exploreCache.elections.slice();
      if (st) items = items.filter((e) => e.state === st);
      if (q) items = items.filter((e) => [e.title, e.gram, e.district, e.state, e.type, e.code].join(' ').toLowerCase().includes(q));
      items = sortElectionsLiveFirst(items, sort);
      listBox.innerHTML = items.map(electionCard).join('');
      const nothingAtAll = !exploreCache.elections.length;
      document.getElementById('emptyBox').innerHTML = items.length ? '' : nothingAtAll
        ? emptyLiveHTML({ onHome: false })
        : `<div class="empty">
          <div class="em-ico">${ICON.search}</div>
          <h3>इस खोज से कोई चुनाव नहीं मिला</h3>
          <p>दूसरा नाम, ज़िला या चुनाव कोड आज़माइए — या अपना नया चुनाव बनाइए (बनते ही यहाँ सबको दिखेगा)।</p>
          <div class="empty-actions">
            <a class="btn btn-primary" href="#/create">चुनाव बनाएँ</a>
            <a class="btn btn-ghost" href="#/explore">सब चुनाव देखें</a>
          </div>
        </div>`;
    };
    let t = null;
    document.getElementById('q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 160); });
    stateSel.addEventListener('change', draw);
    document.getElementById('sortBy').addEventListener('change', draw);
    draw();
  } catch (e) {
    listBox.innerHTML = '';
    document.getElementById('emptyBox').innerHTML = `<div class="empty">
      <div class="em-ico">${ICON.warn}</div><h3>लोड नहीं हो पाया</h3>
      <p>${esc(e.message)}</p>
      <div class="empty-actions">
        <button class="btn btn-primary" id="exploreRetry">फिर कोशिश करें</button>
        <a class="btn btn-ghost" href="#/">होम पर जाएँ</a>
      </div></div>`;
    const rt = document.getElementById('exploreRetry');
    if (rt) rt.addEventListener('click', () => { exploreCache = null; renderExplore(); });
  }
}

/* =====================================================================
   CREATE
   ===================================================================== */

const TYPES = [
  'सरपंच', 'ग्राम प्रधान', 'मुखिया', 'पंचायत सदस्य', 'पंचायत समिति सदस्य',
  'जिला परिषद सदस्य', 'विधायक (MLA)', 'सांसद (MP)', 'नगर पालिका अध्यक्ष',
  'सोसाइटी अध्यक्ष', 'स्कूल/कॉलेज चुनाव', 'अन्य',
];

const INDIAN_STATES = [
  'राजस्थान', 'उत्तर प्रदेश', 'मध्य प्रदेश', 'हरियाणा', 'पंजाब', 'गुजरात',
  'महाराष्ट्र', 'बिहार', 'झारखंड', 'छत्तीसगढ़', 'उत्तराखंड', 'हिमाचल प्रदेश',
  'दिल्ली', 'जम्मू और कश्मीर', 'लद्दाख', 'चंडीगढ़', 'पुडुचेरी', 'गोवा',
  'कर्नाटक', 'केरल', 'तमिलनाडु', 'तेलंगाना', 'आंध्र प्रदेश', 'ओडिशा',
  'पश्चिम बंगाल', 'असम', 'अरुणाचल प्रदेश', 'मणिपुर', 'मेघालय', 'मिजोरम',
  'नागालैंड', 'त्रिपुरा', 'सिक्किम', 'अंडमान और निकोबार',
  'नेपाल', 'अमेरिका', 'दुबई (UAE)', 'अन्य देश',
];

/* ---------- symbol picker ---------- */
let pickerEl = null;
function ensurePicker() {
  if (pickerEl) return pickerEl;
  const el = document.createElement('div');
  el.className = 'sym-modal';
  el.innerHTML = `
    <div class="sym-sheet" role="dialog" aria-modal="true" aria-label="चुनाव चिन्ह चुनें">
      <div class="sym-sheet-head">
        <div><h4>चुनाव चिन्ह चुनें</h4><p>हर उम्मीदवार के लिए एक चिन्ह चुनिए</p></div>
        <button type="button" class="icon-btn sym-close" aria-label="बंद करें">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sym-grid" id="symGrid"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (ev) => {
    if (ev.target === el || ev.target.closest('.sym-close')) closePicker();
  });
  pickerEl = el;
  return el;
}
function openPicker(currentId, onPick) {
  const el = ensurePicker();
  const grid = el.querySelector('#symGrid');
  grid.innerHTML = SYMBOLS.map((s) => `
    <button type="button" class="sym-opt ${s.id === currentId ? 'sel' : ''}" data-id="${s.id}">
      <span class="sym-opt-ico">${symbolSVG(s.id, 30)}</span>
      <span class="sym-opt-name">${esc(s.name)}</span>
    </button>`).join('');
  grid.onclick = (ev) => {
    const b = ev.target.closest('.sym-opt');
    if (!b) return;
    onPick(b.dataset.id);
    closePicker();
  };
  el.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closePicker() {
  if (!pickerEl) return;
  pickerEl.classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

const defaultSymbol = (i) => SYMBOLS[i % SYMBOLS.length].id;

function candRowHTML(i) {
  const sym = defaultSymbol(i);
  return `
  <div class="cand-edit" data-row>
    <div class="idx">${i + 1}</div>
    <input class="c-name" type="text" placeholder="उम्मीदवार का नाम *" maxlength="60" aria-label="उम्मीदवार का नाम" />
    <input class="c-party" type="text" placeholder="पार्टी / समूह (वैकल्पिक)" maxlength="50" aria-label="पार्टी या समूह" />
    <div style="display:flex;gap:8px;align-items:center">
      <button type="button" class="sym-btn c-sym" data-symbol="${sym}" aria-label="चुनाव चिन्ह चुनें" title="चुनाव चिन्ह बदलें">
        <span class="sym-btn-ico">${symbolSVG(sym, 20)}</span>
        <svg class="sym-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <button type="button" class="icon-btn c-del" title="उम्मीदवार हटाएँ" aria-label="उम्मीदवार हटाएँ">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>
      </button>
    </div>
  </div>`;
}

function renumberCands() {
  const rows = $$('#candList [data-row]');
  rows.forEach((row, i) => { row.querySelector('.idx').textContent = i + 1; });
  const c = document.getElementById('candCount');
  if (c) c.textContent = rows.length;
  $$('#candList .c-del').forEach((b) => { b.disabled = rows.length <= 2; b.style.opacity = rows.length <= 2 ? '.4' : ''; });
}

function quotaBannerHTML(q) {
  if (!q) return '';
  const pct = Math.min(100, Math.round((q.used / q.limit) * 100));
  const reset = q.resetsAt ? fullDate(q.resetsAt) : '';
  return `
  <div class="quota-box ${q.remaining === 0 ? 'full' : ''}">
    <div class="quota-top">
      <div>${ICON.ballot} <b>आज की सीमा</b> — ${q.used}/${q.limit} चुनाव बनाए</div>
      <div class="quota-left">${q.remaining > 0 ? `${q.remaining} और बना सकते हैं` : 'सीमा पूरी'}</div>
    </div>
    <div class="quota-track"><i style="width:${pct}%"></i></div>
    <div class="quota-note">हर उपयोगकर्ता 1 दिन में अधिकतम ${q.limit} चुनाव बना सकता है। अगला मौका: ${esc(reset)} (IST)</div>
  </div>`;
}

/* =====================================================================
   📱 कीबोर्ड भाषा-सहायता (Chrome 154–157 का ज्ञात Gboard bug)
   ---------------------------------------------------------------------
   Chromium 154–157 में Gboard का language-selection popup native window
   focus लेते ही Chrome keyboard को छिपा देता है; popup भी उसी के साथ बंद
   हो जाता है। यह native browser bug किसी website के JavaScript से पूरी
   तरह ठीक नहीं हो सकता — page उस popup को खुला रखने का आदेश नहीं दे सकता।
   इसलिए site अब तीन सुरक्षित काम करती है:
   1) keyboard/window transition के दौरान focus या caret से बिल्कुल नहीं
      लड़ती, ताकि page खुद Gboard popup को बंद न करे;
   2) window focus लौटने और viewport स्थिर होने के बाद, यदि DOM focus सच
      में गुम हुआ हो, तो वही खाना व caret एक बार वापस लाती है;
   3) प्रभावित Chrome versions पर उपयोगकर्ता को spacebar hold करने के
      बजाय 🌐 Globe को एक बार tap करने का कामकाजी तरीका दिखाती है।
   ===================================================================== */
function chromiumKeyboardBugMajor() {
  try {
    const ua = navigator.userAgent || '';
    if (!/Android/i.test(ua)) return 0;
    const match = /(?:Chrome|Chromium)\/(\d+)\./i.exec(ua);
    const major = match ? Number(match[1]) : 0;
    return major >= 154 && major <= 157 ? major : 0;
  } catch (_) {
    return 0;
  }
}

function keyboardLanguageTipHTML() {
  const major = chromiumKeyboardBugMajor();
  if (!major) return '';
  try {
    if (localStorage.getItem('janmat_keyboard_tip_v822') === '1') return '';
  } catch (_) {}
  return `
    <div class="keyboard-tip" id="keyboardLanguageTip" role="note">
      <div>
        ⌨️ <b>Chrome ${major} कीबोर्ड सूचना:</b> इस Chrome version में
        <b>spacebar दबाकर रखने</b> से भाषा वाला popup और keyboard बंद हो सकता है।
        भाषा बदलने के लिए spacebar के पास वाले <b>🌐 Globe बटन को सिर्फ़ एक बार tap करें — hold न करें</b>।
        🌐 न दिखे तो Gboard Settings → Preferences → <b>Language switch key</b> चालू करें।
      </div>
      <button type="button" id="keyboardTipClose">समझ आ गया</button>
    </div>`;
}

function bindKeyboardLanguageTip() {
  const tip = document.getElementById('keyboardLanguageTip');
  const btn = document.getElementById('keyboardTipClose');
  if (!tip || !btn) return;
  btn.addEventListener('click', () => {
    try { localStorage.setItem('janmat_keyboard_tip_v822', '1'); } catch (_) {}
    tip.remove();
  });
}

function keepFormFocus(form) {
  if (!form || form.__focusKeeper) return;
  form.__focusKeeper = true;
  const vv = window.visualViewport;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const signal = ac ? ac.signal : undefined;
  let lastField = null;
  let snapshot = null;
  let lostAt = 0;
  let resizeAt = 0;
  let outsideTapAt = 0;
  let windowBlurAt = 0;
  let composing = false;
  let restoreTimer = 0;
  let restores = [];

  const on = (target, type, fn, options) => {
    if (!target || !target.addEventListener) return;
    const opts = typeof options === 'object' && options ? { ...options } : options ? { capture: true } : {};
    if (signal) opts.signal = signal;
    target.addEventListener(type, fn, opts);
  };
  const cleanup = () => {
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = 0;
    if (ac) { try { ac.abort(); } catch (_) {} }
  };
  const alive = () => {
    if (form.isConnected) return true;
    cleanup();
    return false;
  };

  const isEditable = (el) => !!el && form.contains(el) &&
    (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
      (el.tagName === 'INPUT' && !/^(hidden|checkbox|radio|button|submit|file|image|reset)$/i.test(el.type || 'text')));

  const refind = (el) => {
    if (!el) return null;
    if (el.isConnected && form.contains(el)) return el;
    if (el.id) { const n = document.getElementById(el.id); if (n && form.contains(n)) return n; }
    if (el.classList && (el.classList.contains('c-name') || el.classList.contains('c-party'))) {
      const cls = el.classList.contains('c-name') ? 'c-name' : 'c-party';
      const all = form.querySelectorAll('.' + cls);
      return all[Number(el.__candIdx || 0)] || all[0] || null;
    }
    return null;
  };

  const capture = (el) => {
    if (!isEditable(el)) return;
    let start = null;
    let end = null;
    let direction = null;
    try {
      if (typeof el.selectionStart === 'number') start = el.selectionStart;
      if (typeof el.selectionEnd === 'number') end = el.selectionEnd;
      direction = el.selectionDirection || null;
    } catch (_) {}
    snapshot = { field: el, start, end, direction, at: Date.now() };
  };

  const scheduleRestore = (delay = 450) => {
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(tryRestore, delay);
  };

  const tryRestore = () => {
    restoreTimer = 0;
    if (!alive() || !lastField || !lostAt || composing || document.hidden) return;
    /* Native Gboard/system popup खुला हो सकता है — page focus वापस न छीने। */
    if (document.hasFocus && !document.hasFocus()) return;

    const now = Date.now();
    /* Keyboard की ऊँचाई बदलनी पूरी होने तक बिल्कुल हस्तक्षेप नहीं। */
    if (resizeAt && now - resizeAt < 400) {
      scheduleRestore(420 - (now - resizeAt));
      return;
    }

    const act = document.activeElement;
    /* Field या कोई और control focus में है — IME/page से लड़ना नहीं है। */
    if (act && act !== document.body && act !== document.documentElement) return;
    if (outsideTapAt && Math.abs(lostAt - outsideTapAt) < 1500) return;

    const nativeWindowLoss = windowBlurAt && Math.abs(windowBlurAt - lostAt) < 2000;
    const keyboardResizeLoss = resizeAt && Math.abs(resizeAt - lostAt) < 2000;
    if (!nativeWindowLoss && !keyboardResizeLoss) return;
    if (now - lostAt > (nativeWindowLoss ? 30000 : 5000)) return;

    restores = restores.filter((x) => now - x < 10000);
    if (restores.length >= 3) return;

    const el = refind(lastField);
    if (!el || el.disabled || el.readOnly) return;
    const saved = snapshot && (snapshot.field === lastField || snapshot.field === el) ? snapshot : null;
    restores.push(now);
    lostAt = 0;
    windowBlurAt = 0;
    lastField = el;

    try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_2) {} }
    try {
      if (saved && typeof saved.start === 'number' && typeof saved.end === 'number' &&
          el.setSelectionRange && el.tagName !== 'SELECT') {
        const len = typeof el.value === 'string' ? el.value.length : saved.end;
        el.setSelectionRange(Math.min(saved.start, len), Math.min(saved.end, len), saved.direction || undefined);
      }
    } catch (_) {}
  };

  on(form, 'focusin', (ev) => {
    if (!alive() || !isEditable(ev.target)) return;
    lastField = ev.target;
    lostAt = 0;
    outsideTapAt = 0;
    windowBlurAt = 0;
    capture(lastField);
    if (lastField.classList && (lastField.classList.contains('c-name') || lastField.classList.contains('c-party'))) {
      const cls = lastField.classList.contains('c-name') ? 'c-name' : 'c-party';
      lastField.__candIdx = Array.prototype.indexOf.call(form.querySelectorAll('.' + cls), lastField);
    }
  });
  on(form, 'input', (ev) => capture(ev.target));
  on(form, 'keyup', (ev) => capture(ev.target));
  on(form, 'pointerup', (ev) => capture(ev.target));
  on(form, 'compositionstart', () => { composing = true; });
  on(form, 'compositionend', (ev) => {
    composing = false;
    capture(ev.target);
    if (lostAt) scheduleRestore(450);
  });
  on(form, 'focusout', (ev) => {
    if (!alive() || !isEditable(ev.target)) return;
    if (ev.relatedTarget && form.contains(ev.relatedTarget)) return;
    capture(ev.target);
    lostAt = Date.now();
    /* Page के पास window focus न हो तो native popup के लौटने तक प्रतीक्षा। */
    if (!document.hasFocus || document.hasFocus()) scheduleRestore(500);
  });

  on(document, 'pointerdown', (ev) => {
    if (!alive()) return;
    const tg = ev.target;
    if (!tg || tg === lastField) return;
    if (!isEditable(tg)) {
      outsideTapAt = Date.now();
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = 0;
    }
  }, true);
  on(window, 'blur', () => {
    if (!alive()) return;
    windowBlurAt = Date.now();
    if (lastField) capture(lastField);
    const act = document.activeElement;
    if (lastField && !lostAt && (!act || act === document.body || act === document.documentElement)) {
      lostAt = windowBlurAt;
    }
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = 0;
  });
  on(window, 'focus', () => {
    if (alive() && lastField && lostAt) scheduleRestore(300);
  });
  on(document, 'visibilitychange', () => {
    if (!alive()) return;
    if (document.hidden) {
      if (lastField) capture(lastField);
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = 0;
    } else if (lastField && lostAt) {
      scheduleRestore(300);
    }
  });
  on(window, 'pagehide', cleanup);
  if (vv && vv.addEventListener) {
    on(vv, 'resize', () => {
      if (!alive()) return;
      resizeAt = Date.now();
      if (lostAt) scheduleRestore(500);
    });
  }
}

async function renderCreate() {
  setActiveNav('');
  clearPoll();

  if (!state.user) {
    app.innerHTML = `
    <section class="section">
      <div class="wrap wrap-narrow">
        <div class="kicker">नया चुनाव</div>
        <h2 style="font-size:clamp(26px,3.6vw,37px);letter-spacing:-.025em">अपना चुनाव बनाएँ</h2>
        <p class="muted" style="margin:9px 0 22px">चुनाव बनाने के लिए पहले अपना नाम लिखकर लॉगिन करें।</p>
        ${loginCardHTML({ title: 'चुनाव बनाने के लिए लॉगिन करें' })}
        <div class="legal-strip">${ICON.shield}<span>यह मंच सिर्फ़ सामुदायिक/निजी मतदान के लिए है — <a href="#/disclaimer">डिस्क्लेमर पढ़ें</a>।</span></div>
      </div>
    </section>`;
    bindLoginCard(() => renderCreate());
    return;
  }

  let quota = state.quota;
  try {
    const me = await api('/api/auth/me');
    quota = me.quota;
    state.quota = quota;
  } catch (_) {}

  if (quota && quota.remaining <= 0) {
    app.innerHTML = `
    <section class="section">
      <div class="wrap wrap-narrow">
        <div class="kicker">नया चुनाव</div>
        <h2 style="font-size:clamp(24px,3.4vw,34px);letter-spacing:-.025em">आज की सीमा पूरी हो गई</h2>
        <div class="panel limit-card">
          <div class="limit-ico">${ICON.clock}</div>
          <h3>आप आज ${quota.limit} चुनाव बना चुके हैं</h3>
          <p class="muted">हर उपयोगकर्ता 1 दिन में अधिकतम ${quota.limit} चुनाव बना सकता है। अगला चुनाव आप ${esc(fullDate(quota.resetsAt))} (IST) के बाद बना सकते हैं।</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:16px">
            <a class="btn btn-primary" href="#/settings">मेरे चुनाव देखें</a>
            <a class="btn btn-ghost" href="#/explore">मौजूदा चुनावों में वोट करें</a>
          </div>
        </div>
      </div>
    </section>`;
    return;
  }

  app.innerHTML = `
  <section class="section">
    <div class="wrap wrap-narrow">
      <div class="kicker">नया चुनाव</div>
      <h2 style="font-size:clamp(26px,3.6vw,37px);letter-spacing:-.025em">अपना चुनाव बनाएँ</h2>
      <p class="muted" style="margin:9px 0 18px;max-width:40em">
        गाँव / कॉलोनी का नाम, ज़िला और राज्य भरिए, उम्मीदवार जोड़िए — और एक लिंक तैयार जिससे दुनिया में कहीं से भी कोई वोट कर सकता है।
      </p>
      ${quotaBannerHTML(quota)}
      ${keyboardLanguageTipHTML()}

      <form class="panel" id="createForm" novalidate>
        <div class="form-grid">
          <div class="field">
            <label for="type">चुनाव का प्रकार <span class="req">*</span></label>
            <select id="type" name="type">
              ${TYPES.map((t) => `<option ${t === 'सरपंच' ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div class="field" id="customTypeField" style="display:none">
            <label for="customType">अपना प्रकार लिखें</label>
            <input id="customType" type="text" placeholder="जैसे: युवा क्लब अध्यक्ष" maxlength="40" />
          </div>
          <div class="field full">
            <label for="title">चुनाव का शीर्षक <span class="hint">(खाली छोड़ें तो अपने आप बन जाएगा)</span></label>
            <input id="title" type="text" placeholder="जैसे: ग्राम पंचायत सरपंच चुनाव 2026" maxlength="110" />
          </div>
          <div class="field">
            <label for="gram">गाँव / कॉलोनी / वार्ड <span class="req">*</span></label>
            <input id="gram" type="text" placeholder="जैसे: नीमगाँव" maxlength="90" required />
            <span class="hint">जहाँ का चुनाव है उस जगह का नाम</span>
          </div>
          <div class="field">
            <label for="district">ज़िला <span class="req">*</span></label>
            <input id="district" type="text" placeholder="जैसे: अलवर" maxlength="60" required />
          </div>
          <div class="field full">
            <label for="state">राज्य / देश <span class="req">*</span></label>
            <input id="state" type="text" list="stateList" placeholder="जैसे: राजस्थान" maxlength="60" required />
            <datalist id="stateList">${INDIAN_STATES.map((s) => `<option value="${s}"></option>`).join('')}</datalist>
          </div>
        </div>

        <div style="margin-top:28px">
          <div class="section-title">
            <h2 style="font-size:18px">उम्मीदवार</h2>
            <span class="count" id="candCount">2</span>
          </div>
          <p class="hint" style="margin-bottom:12px;color:var(--muted);font-size:13px">
            कम से कम 2 उम्मीदवार ज़रूरी हैं। हर उम्मीदवार के लिए चुनाव चिन्ह चुन सकते हैं।
          </p>
          <div class="cand-list" id="candList">${candRowHTML(0)}${candRowHTML(1)}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="addCand" style="margin-top:12px">＋ उम्मीदवार जोड़ें</button>
        </div>

        <div style="margin-top:30px" id="timerBox">
          <div class="section-title">
            <h2 style="font-size:18px">चुनाव कितनी देर चलेगा? <span class="req">*</span></h2>
            <span class="count" id="durShow">24 घंटे</span>
          </div>
          <p class="hint" style="margin-bottom:12px;color:var(--muted);font-size:13.2px">
            समय आप तय करेंगे। <b>टाइमर चालू होने के बाद आप चुनाव को जल्दी बंद नहीं कर सकेंगे और न ही हटा सकेंगे</b> —
            समय पूरा होते ही चुनाव अपने आप बंद हो जाएगा और परिणाम घोषित हो जाएगा।
          </p>
          <div class="dur-chips" id="durChips">
            ${[[1, '1 मिनट'], [2, '2 मिनट'], [5, '5 मिनट'], [30, '30 मिनट'], [60, '1 घंटा'], [120, '2 घंटे'], [360, '6 घंटे'], [1440, '24 घंटे']]
              .map(([m, l]) => `<button type="button" class="dur-chip${m === 1440 ? ' sel' : ''}" data-min="${m}">${l}</button>`).join('')}
          </div>
          <div class="dur-custom">
            <label for="durValue">अपनी संख्या लिखें</label>
            <input id="durValue" type="number" min="1" step="1" inputmode="numeric" placeholder="जैसे 50 या 100" />
            <select id="durUnit" aria-label="इकाई">
              <option value="1">मिनट</option>
              <option value="60">घंटे</option>
              <option value="1440">दिन</option>
            </select>
          </div>
          <input type="hidden" id="durationMin" value="1440" />
          <p class="lock-note" id="timerNote">${ICON.lock || ICON.shield} यह चुनाव 24 घंटे तक चलेगा — तब तक न बंद होगा, न हटेगा। लॉगआउट करने पर भी चुनाव चलता रहेगा।</p>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary btn-lg" type="submit" id="submitBtn">चुनाव बनाएँ →</button>
          <span class="req-note">${esc(state.user.name)} के नाम से बनेगा · बिलकुल मुफ़्त</span>
        </div>
        <div class="field-error" id="formError" style="margin-top:12px"></div>
      </form>
      <div class="legal-strip">${ICON.shield}<span>यह मंच किसी सरकारी/निर्वाचन-आयोग चुनाव के लिए नहीं है — <a href="#/disclaimer">डिस्क्लेमर पढ़ें</a>।</span></div>
    </div>
  </section>`;

  keepFormFocus(document.getElementById('createForm'));
  bindKeyboardLanguageTip();
  const list = document.getElementById('candList');
  document.getElementById('addCand').addEventListener('click', () => {
    if ($$('#candList [data-row]').length >= 40) return toast('ज़्यादा से ज़्यादा 40 उम्मीदवार जोड़ सकते हैं।', 'err');
    list.insertAdjacentHTML('beforeend', candRowHTML($$('#candList [data-row]').length));
    const rows = $$('#candList [data-row]');
    rows[rows.length - 1].querySelector('.c-name').focus();
    renumberCands();
  });
  list.addEventListener('click', (ev) => {
    const symBtn = ev.target.closest('.c-sym');
    if (symBtn) {
      openPicker(symBtn.dataset.symbol, (id) => {
        symBtn.dataset.symbol = id;
        symBtn.querySelector('.sym-btn-ico').innerHTML = symbolSVG(id, 20);
        symBtn.title = 'चिन्ह: ' + symbolName(id);
        toast('चुनाव चिन्ह: ' + symbolName(id), 'ok');
      });
      return;
    }
    const del = ev.target.closest('.c-del');
    if (!del) return;
    if ($$('#candList [data-row]').length <= 2) return;
    del.closest('[data-row]').remove();
    renumberCands();
  });

  const typeSel = document.getElementById('type');
  const customField = document.getElementById('customTypeField');
  const titleInput = document.getElementById('title');
  let titleTouched = false;
  titleInput.addEventListener('input', () => { titleTouched = !!titleInput.value.trim(); });

  function autoTitle() {
    if (titleTouched) return;
    const gram = document.getElementById('gram').value.trim();
    const type = typeSel.value === 'अन्य'
      ? (document.getElementById('customType').value.trim() || 'चुनाव')
      : typeSel.value;
    titleInput.value = gram ? `${gram} — ${type} चुनाव` : '';
  }
  /* ---------- टाइमर चुनने का तरीक़ा ---------- */
  const durHidden = document.getElementById('durationMin');
  const durValue = document.getElementById('durValue');
  const durUnit = document.getElementById('durUnit');
  const durShow = document.getElementById('durShow');
  const timerNote = document.getElementById('timerNote');
  let durationMin = 1440;

  function setDuration(min, fromCustom) {
    durationMin = Math.max(1, Math.min(43200, Math.round(Number(min) || 1440)));
    durHidden.value = String(durationMin);
    durShow.textContent = fmtDuration(durationMin);
    timerNote.innerHTML = `${ICON.shield} यह चुनाव ${esc(fmtDuration(durationMin))} तक चलेगा — तब तक न बंद होगा, न हटेगा। लॉगआउट करने पर भी चुनाव चलता रहेगा।`;
    if (!fromCustom) {
      $$('#durChips .dur-chip').forEach((c) => c.classList.toggle('sel', Number(c.dataset.min) === durationMin));
    }
  }
  $$('#durChips .dur-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      durValue.value = '';
      setDuration(Number(chip.dataset.min));
    });
  });
  const applyCustom = () => {
    const v = Number(durValue.value);
    if (!v || v <= 0) return;
    $$('#durChips .dur-chip').forEach((c) => c.classList.remove('sel'));
    setDuration(v * Number(durUnit.value), true);
  };
  durValue.addEventListener('input', applyCustom);
  durUnit.addEventListener('change', applyCustom);
  setDuration(1440);

  typeSel.addEventListener('change', () => {
    customField.style.display = typeSel.value === 'अन्य' ? 'flex' : 'none';
    autoTitle();
  });
  document.getElementById('gram').addEventListener('input', autoTitle);
  document.getElementById('customType').addEventListener('input', autoTitle);
  autoTitle();
  renumberCands();

  document.getElementById('createForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = document.getElementById('formError');
    errBox.textContent = '';
    const btn = document.getElementById('submitBtn');

    const type = typeSel.value === 'अन्य' ? (document.getElementById('customType').value.trim() || 'अन्य') : typeSel.value;
    const gram = document.getElementById('gram').value.trim();
    const district = document.getElementById('district').value.trim();
    const st = document.getElementById('state').value.trim();
    const title = titleInput.value.trim();
    const candidates = $$('#candList [data-row]').map((row) => ({
      name: row.querySelector('.c-name').value.trim(),
      party: row.querySelector('.c-party').value.trim(),
      symbol: row.querySelector('.c-sym').dataset.symbol,
    })).filter((c) => c.name);

    if (!gram || !district || !st) {
      errBox.textContent = 'गाँव, ज़िला और राज्य — तीनों भरना ज़रूरी है।';
      (!gram ? document.getElementById('gram') : !district ? document.getElementById('district') : document.getElementById('state')).focus();
      return;
    }
    if (candidates.length < 2) {
      errBox.textContent = 'कम से कम 2 उम्मीदवारों के नाम डालें।';
      return;
    }
    const lower = candidates.map((c) => c.name.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      errBox.textContent = 'एक ही नाम के दो उम्मीदवार नहीं हो सकते।';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'बन रहा है…';
    try {
      const res = await api('/api/elections', {
        method: 'POST',
        body: { type, title, gram, district, state: st, candidates, durationMin },
      });
      state.quota = res.quota;
      exploreCache = null;
      renderCreateSuccess(res.election, res.quota);
    } catch (e) {
      errBox.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'चुनाव बनाएँ →';
      if (e.code === 'DAILY_LIMIT') {
        state.quota = e.data && e.data.quota;
        setTimeout(() => renderCreate(), 1200);
      }
      if (e.code === 'LOGIN_REQUIRED') {
        state.user = null; store.del('jm_token'); renderCreate();
      }
    }
  });
}

function renderCreateSuccess(e, quota) {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const link = shareUrl(e.code);
  const waText = encodeURIComponent(`🗳️ *${e.title}*\n📍 ${e.gram}, ${e.district}, ${e.state}\n\nअपना वोट डालें: ${link}`);
  app.innerHTML = `
  <section class="section">
    <div class="wrap wrap-narrow">
      <div class="success-card fade-up">
        <div class="tick-circle">
          <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
        </div>
        <h2>आपका चुनाव तैयार है!</h2>
        <p>अब इस लिंक को गाँव वालों को भेजिए — कोई भी, कहीं से भी वोट कर सकता है।</p>
        <div style="margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap">
          <span class="badge">${esc(e.type)}</span>
          <span class="badge live"><i></i> मतदान चालू</span>
          <span class="code-pill" style="background:#f4f3fc;border-color:#e2e0f2;color:#4b3fd4">कोड: <b>${e.code}</b></span>
        </div>
        <h3 style="font-size:21px;margin-top:16px;letter-spacing:-.02em">${esc(e.title)}</h3>
        <p class="muted" style="margin-top:6px;font-size:14px">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)}</p>

        <div class="share-box">
          <input id="shareLink" type="text" readonly value="${esc(link)}" aria-label="चुनाव लिंक" />
          <button class="btn btn-primary btn-sm" data-copy="${esc(link)}">कॉपी</button>
        </div>

        <div class="share-actions">
          <a class="btn btn-saffron" target="_blank" rel="noopener" href="https://wa.me/?text=${waText}">WhatsApp पर भेजें</a>
          <a class="btn btn-dark" href="#/e/${e.code}">चुनाव पेज खोलें</a>
          <button class="btn btn-ghost" data-copy="${esc(link)}">लिंक कॉपी करें</button>
        </div>

        ${quota ? `<div style="margin-top:22px">${quotaBannerHTML(quota)}</div>` : ''}

        <div class="timer-banner" style="margin-top:20px">
          <div class="tb-ico">${ICON.clock}</div>
          <div>
            <h4>यह चुनाव ${esc(fmtDuration(e.durationMin || 0))} चलेगा</h4>
            <p class="tb-left" id="createCountdown" data-ends="${e.endsAt || 0}" data-left="${e.remainingMs || 0}">${e.endsAt ? esc(fmtLeft(e.remainingMs || 0)) : ''}</p>
            <p class="muted" style="font-size:13px;margin-top:4px">
              समाप्ति: <b>${e.endsAt ? esc(fullDate(e.endsAt)) : '—'}</b> ·
              समय पूरा होते ही चुनाव अपने आप बंद हो जाएगा। 🔒 तब तक न बंद होगा, न हटेगा — लॉगआउट करने पर भी चलता रहेगा।
            </p>
          </div>
        </div>

        <div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <a class="btn btn-ghost" href="#/settings">मेरे चुनाव देखें</a>
          <a class="btn btn-ghost" href="#/create">＋ एक और चुनाव बनाएँ</a>
        </div>
      </div>
    </div>
  </section>`;
  bindCopyButtons();
  const cd = document.getElementById('createCountdown');
  if (cd && Number(cd.dataset.ends)) {
    const base = Date.now();
    const startLeft = Math.max(0, Number(cd.dataset.left) || 0);
    const tick = () => {
      const left = startLeft - (Date.now() - base);
      cd.textContent = left > 0 ? fmtLeft(left) : 'समय पूरा — चुनाव बंद हो गया';
      if (left <= 0) clearInterval(t);
    };
    tick();
    var t = setInterval(tick, 1000);
  }
  try { history.replaceState(null, '', '#/created/' + e.code); } catch (_) {}
  toast('चुनाव बन गया — लिंक शेयर करें!', 'ok');
}

/* refresh/interaction ke baad bhi success page theek rahe */
async function renderCreated(code) {
  try {
    const e = await api('/api/elections/' + encodeURIComponent(code));
    if (!e.canManage) { location.hash = '#/e/' + e.code; return; }
    if (state.user) {
      try { const me = await api('/api/auth/me'); state.quota = me.quota; } catch (_) {}
    }
    renderCreateSuccess(e, state.quota);
  } catch (err) {
    location.hash = '#/e/' + code;
  }
}

/* =====================================================================
   ELECTION PAGE
   ===================================================================== */

let pollTimer = null;
let countdownTimer = null;

function clearPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  /* 🐞 FIX: डेव पैनल के single-चुनाव वाला 5-सेकंड टाइमर भी बंद करो —
     वरना होम/सेटिंग्स पर जाने के बाद वह पुराना पेज वापस चिपका देता था। */
  if (typeof devDetailTimer !== 'undefined' && devDetailTimer) {
    clearInterval(devDetailTimer);
    devDetailTimer = null;
  }
  closeLive();
}

function resultsHTML(d) {
  const r = d.results || { totalVotes: d.totalVotes || 0, candidates: [], winnerIds: [], tie: false };
  const total = Number(r.totalVotes != null ? r.totalVotes : d.totalVotes) || 0;
  const hidden = d.resultsHidden === true || r.resultsHidden === true || !d.closed;

  if (hidden) {
    const hiddenRows = (Array.isArray(r.candidates) && r.candidates.length ? r.candidates : (d.candidates || []))
      .map((c) => `
      <div class="res-row">
        <div class="res-top">
          <div class="res-sym">${symbolSVG(c.symbol, 22)}</div>
          <div style="min-width:0">
            <div class="res-name">${esc(c.name)}</div>
            <div class="res-party">${c.party ? esc(c.party) : 'निर्दलीय'}</div>
          </div>
          <div class="res-num"><b>🔒</b><span>छिपा</span></div>
        </div>
        <div class="res-track"><div class="res-fill" style="width:0%"></div></div>
        <div class="res-foot"><span>उम्मीदवार</span><span>गिनती मतदान समाप्त होने पर</span></div>
      </div>`).join('');

    return `
      <div class="status-banner warn"><div class="sb-ico">${ICON.lock}</div><div>
        <h4>उम्मीदवारों की गिनती अभी छिपी है</h4>
        <p>मतदान चलने के दौरान कुल वोट संख्या और उम्मीदवारों की गिनती केवल डेवलपर देख सकता है। ${d.endsAt ? `परिणाम <b>${esc(fullDate(d.endsAt))}</b> पर अपने आप सबके लिए खुल जाएगा।` : 'चुनाव बंद होते ही परिणाम सबके लिए खुल जाएगा।'}</p>
      </div></div>
      <div class="total-strip">
        <div class="ts-item"><b>🔒</b><span>कुल वोट (छिपे)</span></div>
        <div class="divider"></div>
        <div class="ts-item"><b>${d.candidates.length}</b><span>उम्मीदवार</span></div>
        <div class="divider"></div>
        <div class="ts-item"><b>छिपा</b><span>परिणाम</span></div>
        <div class="divider"></div>
        <div class="ts-item" style="margin-left:auto"><span class="live-note" id="liveNote">कुल वोट और उम्मीदवारों की गिनती मतदान समाप्त होने पर दिखेगी</span></div>
      </div>
      <div class="results">${hiddenRows}</div>`;
  }

  const candidates = Array.isArray(r.candidates) ? r.candidates : [];
  const winnerIds = Array.isArray(r.winnerIds) ? r.winnerIds : [];
  const maxVotes = Math.max(1, ...candidates.map((c) => Number(c.votes) || 0));
  const rows = candidates.map((c, i) => {
    const votes = Number(c.votes) || 0;
    const isWinner = winnerIds.includes(c.id);
    const pct = total ? (votes / total) * 100 : 0;
    return `
    <div class="res-row ${isWinner ? 'win' : ''}">
      <div class="res-top">
        <div class="res-sym">${symbolSVG(c.symbol, 22)}</div>
        <div style="min-width:0">
          <div class="res-name">${esc(c.name)}
            ${isWinner ? '<span class="crown" title="विजेता">👑</span>' : ''}
          </div>
          <div class="res-party">${c.party ? esc(c.party) : 'निर्दलीय'}</div>
        </div>
        <div class="res-num"><b>${fmt(votes)}</b><span>${c.percent}%</span></div>
      </div>
      <div class="res-track"><div class="res-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="res-foot"><span>क्रम #${i + 1}</span><span>${fmt(votes)} / ${fmt(total)} वोट</span></div>
    </div>`;
  }).join('');

  let banner = '';
  if (r.tie) {
    banner = `<div class="winner-card"><div class="trophy">${ICON.handshake}</div><div>
      <h4>अंतिम परिणाम</h4><div class="wname">बराबरी का चुनाव</div>
      <div class="wsub">${candidates.filter((c) => (Number(c.votes) || 0) === maxVotes).map((c) => esc(c.name)).join(' और ')} — बराबर वोट</div></div></div>`;
  } else if (winnerIds.length) {
    const w = candidates.find((c) => c.id === winnerIds[0]);
    if (w) {
      banner = `<div class="winner-card"><div class="trophy">${ICON.trophy}</div><div>
        <h4>विजेता की घोषणा</h4>
        <div class="wname" style="display:flex;align-items:center;gap:9px">${symbolSVG(w.symbol, 26)} ${esc(w.name)}</div>
        <div class="wsub">${w.party ? esc(w.party) + ' · ' : ''}${fmt(w.votes)} वोट · ${w.percent}% हिस्सा</div></div></div>`;
    }
  } else {
    banner = `<div class="status-banner warn"><div class="sb-ico">${ICON.warn}</div><div><h4>कोई वोट नहीं पड़ा</h4><p>इस चुनाव में एक भी वोट दर्ज नहीं हुआ।</p></div></div>`;
  }

  return `
    ${banner}
    <div class="total-strip">
      <div class="ts-item"><b>${fmt(total)}</b><span>कुल वोट</span></div>
      <div class="divider"></div>
      <div class="ts-item"><b>${d.candidates.length}</b><span>उम्मीदवार</span></div>
      <div class="divider"></div>
      <div class="ts-item"><b>घोषित</b><span>स्थिति</span></div>
      <div class="divider"></div>
      <div class="ts-item" style="margin-left:auto"><span class="live-note" id="liveNote">परिणाम स्थायी रूप से सुरक्षित</span></div>
    </div>
    <div class="results">${rows}</div>`;
}

/* ===== RESULT-CARD-START ===== */
/* =====================================================================
   🏆 परिणाम कार्ड — HD तस्वीर (PNG) डाउनलोड/शेयर के लिए
   ---------------------------------------------------------------------
   उपयोगकर्ता चुनाव का परिणाम सुंदर फ़्रेम में सेव कर सकता है।
   कार्ड के बिल्कुल नीचे साफ़ डिस्क्लेमर पट्टी हमेशा छपती है:
   यह जीत/परिणाम निर्वाचन आयोग के लिए मान्य नहीं है — यह सिर्फ़
   सामुदायिक समर्थन का अंदाज़ा है।
   ===================================================================== */

function _symbolImageForCard(id) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), 1800);   // किसी कारण अटके तो कार्ड रुके नहीं
    try {
      const svg = symbolSVG(id, 160).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      const img = new Image();
      img.onload = () => finish(img);
      img.onerror = () => finish(null);
      /* base64 data-URI हर browser/WebView में सबसे भरोसेमंद चलता है */
      if (window.TextEncoder) {
        const bytes = new TextEncoder().encode(svg);
        let bin = '';
        bytes.forEach((b) => { bin += String.fromCharCode(b); });
        img.src = 'data:image/svg+xml;base64,' + btoa(bin);
      } else {
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      }
    } catch (_) { finish(null); }
  });
}

function _wrapCardText(x, text, maxW, maxLines) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let i = 0;
  let line = '';
  while (i < words.length) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (x.measureText(test).width <= maxW || !line) { line = test; i++; } else {
      lines.push(line);
      line = '';
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) { lines.push(line); line = ''; }
  const more = i < words.length || !!line;
  if (more && lines.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && x.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = last.replace(/\s+$/, '') + '…';
  }
  return lines.length ? lines : [''];
}

function _fitOneLine(x, text, maxW) {
  const s = String(text == null ? '' : text);
  if (x.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && x.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out.replace(/\s+$/, '') + '…';
}

async function resultCardCanvas(d) {
  if (!d || !d.closed) throw new Error('परिणाम कार्ड मतदान समाप्त होने के बाद ही बनेगा।');
  const F = '"Noto Sans Devanagari", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const res = (d && d.results) || {};
  const all = (Array.isArray(res.candidates) ? res.candidates.slice() : [])
    .sort((a, b) => (Number(b.votes) || 0) - (Number(a.votes) || 0));
  const total = Number(res.totalVotes != null ? res.totalVotes
    : (d.totalVotes != null ? d.totalVotes : all.reduce((s, c) => s + (Number(c.votes) || 0), 0))) || 0;
  const maxV = all.reduce((m, c) => Math.max(m, Number(c.votes) || 0), 0);
  const leaders = (total > 0 && maxV > 0) ? all.filter((c) => (Number(c.votes) || 0) === maxV) : [];
  const tie = leaders.length > 1;
  const MAXR = 10;
  const shown = all.length > MAXR ? all.slice(0, MAXR - 1) : all;
  const extra = all.length - shown.length;
  const pctOf = (c) => {
    const p = Number(c.percent);
    if (isFinite(p)) return p;
    return total ? Math.round(((Number(c.votes) || 0) / total) * 1000) / 10 : 0;
  };

  /* चुनाव चिन्हों की तस्वीरें पहले से तैयार */
  const symImgs = {};
  await Promise.all([...new Set(shown.map((c) => c.symbol))].map(async (id) => {
    symImgs[id] = await _symbolImageForCard(id);
  }));
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) {}

  /* -------- नाप (पहले ऊँचाई निकालो, फिर बनाओ) -------- */
  const W = 1080;
  const M = 36;                 // बाहर की किनारी
  const cardX = M, cardW = W - M * 2;
  const inX = cardX + 46, inW = cardW - 92;
  const rowH = shown.length <= 5 ? 134 : shown.length <= 8 ? 118 : 106;
  const rowGap = 14;

  const meas = document.createElement('canvas').getContext('2d');
  meas.font = '800 47px ' + F;
  const titleLines = _wrapCardText(meas, d.title || 'चुनाव परिणाम', inW, 2);
  meas.font = '600 25px ' + F;
  const disclaimer = 'ज़रूरी सूचना: यह जनमत का अनौपचारिक सामुदायिक राय-सर्वे मात्र है। यह जीत/परिणाम निर्वाचन आयोग या किसी सरकारी चुनाव के लिए मान्य नहीं है। यह केवल यह अंदाज़ा देता है कि उम्मीदवार को लोगों का कितना समर्थन मिल सकता है — वास्तविक परिणाम आधिकारिक मतगणना से ही तय होगा।';
  const discLines = _wrapCardText(meas, disclaimer, inW - 120, 6);
  const discH = discLines.length * 36 + 42;

  let est = 40;                                   // कार्ड ऊपर की जगह
  est += 76;                                      // ब्रांड पंक्ति
  est += 30;                                      // लकीर + दूरी
  est += 36;                                      // प्रकार (किकर)
  est += titleLines.length * 58 + 6;              // शीर्षक
  est += 40 + 38;                                 // स्थान + गिनती पंक्तियाँ
  est += 24 + 120;                                // आगे/विजेता पट्टी
  est += 26 + shown.length * rowH + Math.max(0, shown.length - 1) * rowGap;
  if (extra > 0) est += 46;
  if (!shown.length) est += 60;
  est += 30 + 44;                                 // नीचे ब्रांड पंक्ति
  est += 20 + discH;                              // डिस्क्लेमर पट्टी
  est += 38;                                      // कार्ड नीचे की जगह
  const H = Math.max(1180, est + M * 2);

  /* -------- बनाना शुरू -------- */
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.textBaseline = 'middle';

  // पृष्ठभूमि: गहरा नीला ग्रेडिएंट + हल्की चमक
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#232a63'); bg.addColorStop(0.55, '#141a45'); bg.addColorStop(1, '#0c1030');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  [[120, 150, 280, 'rgba(255,176,32,.20)'], [990, 260, 230, 'rgba(109,91,246,.28)'],
   [920, H - 180, 320, 'rgba(255,255,255,.08)'], [90, H - 320, 200, 'rgba(255,157,10,.12)']]
    .forEach(([cx, cy, r, col]) => {
      const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = rg; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    });

  // सफ़ेद कार्ड + सुनहरी अंदरूनी किनारी
  const cardY = M, cardH = H - M * 2;
  x.save();
  x.shadowColor = 'rgba(0,0,0,.38)'; x.shadowBlur = 44; x.shadowOffsetY = 20;
  roundRect(x, cardX, cardY, cardW, cardH, 42);
  x.fillStyle = '#ffffff'; x.fill();
  x.restore();
  roundRect(x, cardX + 11, cardY + 11, cardW - 22, cardH - 22, 33);
  x.strokeStyle = 'rgba(255,157,10,.55)'; x.lineWidth = 3; x.stroke();

  let y = cardY + 40;

  /* ब्रांड पंक्ति */
  const markG = x.createLinearGradient(inX, y, inX + 66, y + 66);
  markG.addColorStop(0, '#ffb020'); markG.addColorStop(1, '#f97316');
  roundRect(x, inX, y + 4, 66, 66, 18);
  x.fillStyle = markG; x.fill();
  x.strokeStyle = '#ffffff'; x.lineWidth = 7; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(inX + 19, y + 38); x.lineTo(inX + 30, y + 49); x.lineTo(inX + 49, y + 26); x.stroke();
  x.fillStyle = '#131735';
  x.font = '800 45px ' + F;
  x.fillText('जनमत', inX + 84, y + 30);
  x.fillStyle = '#6b7093';
  x.font = '600 21px ' + F;
  x.fillText('JANMAT · सामुदायिक राय-सर्वे', inX + 86, y + 62);
  // स्थिति बैज (दाएँ)
  const badge = 'अंतिम परिणाम';
  x.font = '800 24px ' + F;
  const bw = x.measureText(badge).width + 44;
  roundRect(x, cardX + cardW - 46 - bw, y + 12, bw, 48, 24);
  x.fillStyle = d.closed ? '#e6f8f0' : '#fff4e0'; x.fill();
  x.fillStyle = d.closed ? '#0a7d4e' : '#b26a00';
  x.textAlign = 'center';
  x.fillText(badge, cardX + cardW - 46 - bw / 2, y + 37);
  x.textAlign = 'left';
  y += 76;

  // लकीर
  y += 18;
  x.strokeStyle = '#eceaf6'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(inX, y); x.lineTo(inX + inW, y); x.stroke();
  y += 12;

  /* प्रकार + शीर्षक + स्थान */
  x.fillStyle = '#e28300';
  x.font = '800 25px ' + F;
  x.fillText(_fitOneLine(x, (d.type || 'चुनाव') + ' चुनाव · परिणाम कार्ड', inW), inX, y + 17);
  y += 36;
  x.fillStyle = '#131735';
  x.font = '800 47px ' + F;
  titleLines.forEach((ln) => { x.fillText(ln, inX, y + 29); y += 58; });
  y += 6;
  x.fillStyle = '#3b4066';
  x.font = '600 27px ' + F;
  const place = [d.gram, d.district, d.state].filter(Boolean).join(' · ');
  x.fillText(_fitOneLine(x, 'स्थान: ' + place, inW), inX, y + 20);
  y += 40;
  x.fillStyle = '#6b7093';
  x.font = '600 25px ' + F;
  x.fillText(_fitOneLine(x, `कुल वोट: ${fmt(total)}  ·  उम्मीदवार: ${fmt(all.length)}  ·  चुनाव कोड: ${d.code || ''}`, inW), inX, y + 19);
  y += 38;

  /* विजेता / सबसे आगे पट्टी */
  y += 24;
  const bandH = 120;
  const bandG = x.createLinearGradient(inX, y, inX + inW, y);
  if (total > 0) { bandG.addColorStop(0, '#ffb020'); bandG.addColorStop(1, '#ff8a3d'); }
  else { bandG.addColorStop(0, '#e9e9f2'); bandG.addColorStop(1, '#dcdce9'); }
  roundRect(x, inX, y, inW, bandH, 26);
  x.fillStyle = bandG; x.fill();
  if (total > 0 && leaders.length) {
    x.beginPath(); x.arc(inX + 58, y + bandH / 2, 34, 0, Math.PI * 2);
    x.fillStyle = 'rgba(255,255,255,.28)'; x.fill();
    x.fillStyle = '#ffffff';
    x.font = '800 40px ' + F;
    x.textAlign = 'center';
    x.fillText('★', inX + 58, y + bandH / 2 + 2);
    x.textAlign = 'left';
    const leadLabel = tie ? 'बराबरी — सर्वाधिक मत पाने वाले'
      : d.closed ? 'विजेता (इस सर्वे के अनुसार)' : 'अभी सबसे आगे';
    x.fillStyle = 'rgba(36,20,0,.72)';
    x.font = '700 23px ' + F;
    x.fillText(leadLabel, inX + 112, y + 34);
    const leadName = leaders.map((c) => c.name).join(' व ');
    x.fillStyle = '#241400';
    x.font = '800 38px ' + F;
    x.fillText(_fitOneLine(x, leadName, inW - 330), inX + 112, y + 76);
    const lpct = total ? Math.round((maxV / total) * 1000) / 10 : 0;
    x.textAlign = 'right';
    x.fillStyle = '#241400';
    x.font = '800 44px ' + F;
    x.fillText(fmt(maxV) + ' वोट', inX + inW - 30, y + 44);
    x.font = '700 26px ' + F;
    x.fillStyle = 'rgba(36,20,0,.72)';
    x.fillText(lpct + '% हिस्सा', inX + inW - 30, y + 84);
    x.textAlign = 'left';
  } else {
    x.fillStyle = '#3b4066';
    x.font = '800 32px ' + F;
    x.textAlign = 'center';
    x.fillText('अभी तक कोई वोट नहीं पड़ा', inX + inW / 2, y + bandH / 2);
    x.textAlign = 'left';
  }
  y += bandH;

  /* उम्मीदवार पंक्तियाँ */
  y += 26;
  const medal = ['#f5b301', '#9aa3b2', '#c47b42'];
  shown.forEach((c, i) => {
    const votes = Number(c.votes) || 0;
    const isLead = total > 0 && votes === maxV && maxV > 0;
    roundRect(x, inX, y, inW, rowH, 22);
    x.fillStyle = isLead ? '#fff6df' : '#f7f7fd';
    x.fill();
    if (isLead) {
      x.strokeStyle = 'rgba(255,157,10,.65)'; x.lineWidth = 2.5; x.stroke();
    }
    // क्रम गोला
    x.beginPath(); x.arc(inX + 42, y + 46, 21, 0, Math.PI * 2);
    x.fillStyle = medal[i] || '#d9d9e8'; x.fill();
    x.fillStyle = i < 3 ? '#ffffff' : '#565d80';
    x.font = '800 24px ' + F;
    x.textAlign = 'center';
    x.fillText(String(i + 1), inX + 42, y + 47);
    x.textAlign = 'left';
    // चिन्ह टाइल
    const tileX = inX + 78, tileY = y + 16, tileS = 64;
    roundRect(x, tileX, tileY, tileS, tileS, 16);
    x.fillStyle = '#ffffff'; x.fill();
    x.strokeStyle = '#e4e2f0'; x.lineWidth = 2; x.stroke();
    const img = symImgs[c.symbol];
    if (img) {
      try { x.drawImage(img, tileX + 9, tileY + 9, tileS - 18, tileS - 18); } catch (_) {}
    } else {
      x.fillStyle = '#4b3fd4';
      x.font = '800 30px ' + F;
      x.textAlign = 'center';
      x.fillText(String(c.name || '?').trim().charAt(0) || '?', tileX + tileS / 2, tileY + tileS / 2 + 1);
      x.textAlign = 'left';
    }
    // नाम + पार्टी
    const nameX = tileX + tileS + 20;
    const numW = 190;
    x.fillStyle = '#131735';
    x.font = '800 32px ' + F;
    x.fillText(_fitOneLine(x, c.name || '', inW - (nameX - inX) - numW), nameX, y + 38);
    x.fillStyle = '#6b7093';
    x.font = '600 23px ' + F;
    x.fillText(_fitOneLine(x, c.party ? c.party : 'निर्दलीय', inW - (nameX - inX) - numW), nameX, y + 72);
    // वोट संख्या + %
    x.textAlign = 'right';
    x.fillStyle = '#131735';
    x.font = '800 38px ' + F;
    x.fillText(fmt(votes), inX + inW - 28, y + 40);
    x.fillStyle = '#6b7093';
    x.font = '700 24px ' + F;
    x.fillText(pctOf(c) + '%', inX + inW - 28, y + 74);
    x.textAlign = 'left';
    // प्रगति पट्टी
    const barX = nameX, barW = inW - (nameX - inX) - 28, barY = y + rowH - 30;
    roundRect(x, barX, barY, barW, 13, 7);
    x.fillStyle = '#e8e8f3'; x.fill();
    const fw = maxV > 0 ? Math.max(0, Math.min(barW, (votes / maxV) * barW)) : 0;
    if (fw > 4) {
      const fg = x.createLinearGradient(barX, 0, barX + barW, 0);
      if (isLead) { fg.addColorStop(0, '#ffb020'); fg.addColorStop(1, '#f97316'); }
      else { fg.addColorStop(0, '#6d5bf6'); fg.addColorStop(1, '#4b3fd4'); }
      roundRect(x, barX, barY, fw, 13, 7);
      x.fillStyle = fg; x.fill();
    }
    y += rowH + rowGap;
  });
  if (shown.length) y -= rowGap;
  if (extra > 0) {
    x.fillStyle = '#6b7093';
    x.font = '600 24px ' + F;
    x.textAlign = 'center';
    x.fillText(`+ ${fmt(extra)} और उम्मीदवार — पूरी सूची साइट पर देखें`, inX + inW / 2, y + 26);
    x.textAlign = 'left';
    y += 46;
  }
  if (!shown.length) y += 60;

  /* नीचे ब्रांड पंक्ति */
  y += 30;
  x.fillStyle = '#131735';
  x.font = '800 27px ' + F;
  x.fillText('जनमत', inX, y + 20);
  const brandW = x.measureText('जनमत').width;
  x.fillStyle = '#6b7093';
  x.font = '600 24px ' + F;
  x.fillText('· a2zmatdaan.github.io', inX + brandW + 12, y + 20);
  let dateStr = '';
  try {
    dateStr = new Date(d.closedAt || Date.now()).toLocaleString('hi-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {}
  x.textAlign = 'right';
  x.fillText(dateStr, inX + inW, y + 20);
  x.textAlign = 'left';
  y += 44;

  /* डिस्क्लेमर पट्टी — बिल्कुल नीचे, साफ़-साफ़ */
  y += 20;
  roundRect(x, inX, y, inW, discH, 20);
  x.fillStyle = '#fff4e5'; x.fill();
  x.strokeStyle = '#ffd9a0'; x.lineWidth = 2; x.stroke();
  x.beginPath(); x.arc(inX + 44, y + 48, 20, 0, Math.PI * 2);
  x.fillStyle = '#e5484d'; x.fill();
  x.fillStyle = '#ffffff';
  x.font = '800 28px ' + F;
  x.textAlign = 'center';
  x.fillText('!', inX + 44, y + 49);
  x.textAlign = 'left';
  x.fillStyle = '#5c3800';
  x.font = '600 25px ' + F;
  let dy = y + 21 + 18;
  discLines.forEach((ln) => { x.fillText(ln, inX + 84, dy); dy += 36; });

  return cv;
}

async function downloadResultCard(code, btn) {
  const old = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'कार्ड बन रहा है…'; }
  try {
    const fresh = await api('/api/elections/' + encodeURIComponent(code));
    if (!fresh.closed) {
      toast('परिणाम कार्ड मतदान समाप्त होने के बाद ही बनेगा — चलती गिनती केवल डेवलपर देख सकता है।', 'err');
      return;
    }
    const cv = await resultCardCanvas(fresh);
    const name = 'janmat-parinaam-' + String(fresh.code || code || 'card') + '.png';
    const save = (href) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (cv.toBlob) {
      await new Promise((res) => {
        cv.toBlob((b) => {
          if (b) {
            const u = URL.createObjectURL(b);
            save(u);
            setTimeout(() => { try { URL.revokeObjectURL(u); } catch (_) {} }, 4000);
          } else {
            save(cv.toDataURL('image/png'));
          }
          res();
        }, 'image/png');
      });
    } else {
      save(cv.toDataURL('image/png'));
    }
    toast('परिणाम कार्ड डाउनलोड हो गया', 'ok');
  } catch (e) {
    toast('कार्ड नहीं बन पाया — ' + (e && e.message ? e.message : 'कुछ देर बाद प्रयास करें'), 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}
/* ===== RESULT-CARD-END ===== */

function voteAreaHTML(d) {
  if (d.closed) {
    return `<div class="status-banner warn"><div class="sb-ico">${ICON.lock}</div>
      <div><h4>यह चुनाव समाप्त हो चुका है</h4><p>अब नए वोट दर्ज नहीं हो सकते। नीचे अंतिम परिणाम देखिए।</p></div></div>`;
  }
  /* 🟢 शेयर किए लिंक से आया मतदाता — लॉगिन के बिना सीधे वोट */
  const guestNote = state.user ? '' : `
    <div class="guest-note">
      <b>सीधे वोट कीजिए — किसी लॉगिन की ज़रूरत नहीं।</b>
      <span>बस अपना उम्मीदवार चुनिए और "वोट दर्ज करें" दबाइए। एक फ़ोन से एक ही वोट गिना जाएगा।</span>
    </div>`;
  if (d.hasVoted) {
    const my = d.candidates.find((c) => c.id === d.myVote);
    return `<div class="status-banner ok">
      <div class="sb-ico"><div class="tick-circle" style="width:34px;height:34px;margin:0;box-shadow:none;animation:none">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
      </div></div>
      <div><h4>आपका वोट दर्ज हो चुका है</h4>
      <p>${my ? `आपने <b>${esc(my.name)}</b> को वोट दिया।` : 'इस चुनाव में आपका वोट दर्ज है।'} धन्यवाद!</p>
      ${state.user ? '' : '<p class="muted small">चाहें तो <a href="#/login">username से लॉगिन</a> कर लें — इससे आपका रिकॉर्ड सुरक्षित रहेगा।</p>'}</div></div>`;
  }
  return `
    ${guestNote}
    <div class="vote-grid" id="voteGrid">
      ${d.candidates.map((c) => `
        <button type="button" class="vcard" data-id="${c.id}">
          <div class="vsym">${symbolSVG(c.symbol, 28)}</div>
          <div class="vinfo">
            <div class="vname">${esc(c.name)}</div>
            <div class="vparty">${c.party ? esc(c.party) : 'निर्दलीय'}</div>
          </div>
          <div class="vradio"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
        </button>`).join('')}
    </div>
    <div class="vote-bar">
      <div class="sel-info" id="selInfo">अपना उम्मीदवार चुनिए</div>
      <button class="btn btn-primary btn-lg" id="voteBtn" disabled>वोट दर्ज करें</button>
    </div>
    <p class="vote-hint">${ICON.shield} ${state.user ? 'आपका नाम और वोट किसी को नहीं दिखता — सिर्फ़ आप और डेवलपर देख सकते हैं।' : 'आपका नाम नहीं पूछा जाता — वोट गुप्त रहता है।'} एक डिवाइस से एक ही वोट।</p>`;
}

function electionHTML(d) {
  const link = shareUrl(d.code);
  const waText = encodeURIComponent(`🗳️ *${d.title}*\n📍 ${d.gram}, ${d.district}, ${d.state}\n\nसीधे वोट कीजिए (किसी लॉगिन की ज़रूरत नहीं) 👇\n${link}`);
  const statusBadge = d.closed
    ? '<span class="badge closed">चुनाव समाप्त</span>'
    : '<span class="badge live"><i></i> मतदान चल रहा है</span>';


  const lock = electionLock(d);
  const closedBtnLabel = d.closed
    ? (lock.timeUp ? 'समय पूरा — दोबारा नहीं खुलेगा' : 'चुनाव फिर खोलें')
    : 'चुनाव समाप्त करें';
  const closeDisabled = lock.locked || (d.closed && lock.timeUp);
  const deleteReady = d.canDelete != null ? d.canDelete : (d.closed || lock.timeUp);
  const adminBox = d.canManage ? `
    <div class="panel admin-box">
      <div class="admin-row">
        <div>
          <h4 style="display:flex;align-items:center;gap:7px">${ICON.key} आयोजक नियंत्रण</h4>
          ${d.endsAt ? `<p class="admin-timer-line">${ICON.clock} <b id="adminTimer" data-left="${d.remainingMs || 0}">${esc(fmtLeft(d.remainingMs || 0))}</b> · कुल अवधि ${esc(fmtDuration(d.durationMin || 0))} · समाप्ति ${esc(fullDate(d.endsAt))}</p>` : ''}
          <p>${lock.locked
            ? '🔒 चुनाव चल रहा है। तय समय से पहले न बंद होगा, न हटेगा — समय पूरा होते ही अपने आप बंद हो जाएगा।'
            : d.closed
              ? (lock.timeUp ? 'समय पूरा — चुनाव अपने आप बंद हो गया। अब इसे हटाया जा सकता है।' : 'चुनाव बंद है — आप इसे दोबारा खोल सकते हैं।')
              : 'चुनाव बंद करते ही विजेता की घोषणा हो जाएगी और वोटिंग रुक जाएगी।'}</p>
        </div>
        <div class="admin-btns">
          <button class="btn ${d.closed ? 'btn-ghost' : 'btn-danger'}" id="toggleClose" ${closeDisabled ? 'disabled' : ''}>${closedBtnLabel}</button>
          <button class="btn btn-ghost btn-sm" id="deleteElection" ${deleteReady ? '' : 'disabled'} title="${deleteReady ? 'चुनाव पूरी साइट से हटाएँ' : 'समय पूरा होने के बाद ही हटा सकते हैं'}">चुनाव हटाएँ</button>
        </div>
      </div>
      ${lock.locked ? `<p class="lock-hint">🔒 समय से पहले लॉक — तय समय: ${esc(fmtDuration(d.durationMin || 0))}। लॉगआउट करने पर भी यह चुनाव साइट पर चलता रहेगा।</p>` : ''}
    </div>` : '';

  return `
  <section class="ehead">
    <div class="wrap ehead-inner">
      <div class="crumbs"><a href="#/">होम</a> <span>›</span> <a href="#/explore">चुनाव</a> <span>›</span> <span>${esc(d.code)}</span></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${statusBadge}
        <span class="badge">${esc(d.type)}</span>
        ${d.demo ? '<span class="badge">डेमो चुनाव</span>' : ''}
        ${d.canManage ? '<span class="badge" style="background:rgba(35,209,139,.18);color:#7cf5c4">आपका चुनाव</span>' : ''}
      </div>
      <h1>${esc(d.title)}</h1>
      <div class="ehead-meta">
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(d.gram)} · ${esc(d.district)} · ${esc(d.state)}</span>
        <span>${ICON.ballot} ${d.closed ? `<b id="headVotes">${fmt(d.totalVotes)}</b> वोट पड़े` : '<b id="headVotes">🔒</b> वोट संख्या छिपी'}</span>
        <span>${ICON.clock} ${timeAgo(d.createdAt)}</span>
        ${d.endsAt && !d.closed ? `<span class="ehead-timer">⏳ <b data-left="${d.remainingMs || 0}">${esc(fmtLeft(d.remainingMs || 0))}</b></span>` : ''}
        ${d.endsAt && d.closed ? `<span class="ehead-timer done">समाप्त ${esc(shortDate(d.endsAt))}</span>` : ''}
        <span class="code-pill">कोड: <b>${esc(d.code)}</b></span>
      </div>
      <div class="ehead-actions">
        <button class="btn btn-saffron btn-sm" data-copy="${esc(link)}">${ICON.link} लिंक कॉपी करें</button>
        <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${waText}">WhatsApp पर शेयर</a>
        ${d.closed ? '<button class="btn btn-ghost btn-sm js-result-card" type="button">📥 परिणाम कार्ड</button>' : ''}
        <a class="btn btn-ghost btn-sm" href="#/explore">सारे चुनाव</a>
      </div>
    </div>
  </section>

  <section class="content">
    <div class="wrap wrap-narrow">
      <div class="section-title">
        <h2>${d.closed ? 'अंतिम परिणाम' : d.hasVoted ? 'आपका वोट' : 'अपना वोट डालिए'}</h2>
        ${d.closed ? '' : '<span class="badge live"><i></i> मतदान जारी</span>'}
      </div>
      <div id="voteArea">${voteAreaHTML(d)}</div>

      <div style="margin-top:34px">
        <div class="section-title">
          <h2>${d.closed ? 'अंतिम परिणाम' : 'परिणाम — मतदान के बाद'}</h2>
          <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${d.closed ? '<button class="btn btn-ghost btn-sm js-result-card" type="button">📥 परिणाम कार्ड डाउनलोड</button>' : ''}
            <span class="badge ${d.closed ? 'closed' : 'live'}"><i id="liveDot"></i> <span id="liveLabel">${d.closed ? 'घोषित' : 'गिनती छिपी'}</span></span>
          </span>
        </div>
        <div id="resultsBox">${resultsHTML(d)}</div>
      </div>

      <div style="margin-top:26px">
        <div class="panel">
          <div class="section-title" style="margin-bottom:12px"><h2 style="font-size:16.5px">यह चुनाव शेयर करें</h2></div>
          <div class="share-box" style="margin:0;max-width:none">
            <input type="text" readonly value="${esc(link)}" aria-label="चुनाव लिंक" />
            <button class="btn btn-primary btn-sm" data-copy="${esc(link)}">कॉपी</button>
          </div>
          <p class="req-note">कोड <b>${esc(d.code)}</b> से भी लोग इसे “चुनाव खोजें” पेज पर ढूँढ सकते हैं।</p>
          <p class="muted small" style="margin-top:12px">
            इस चुनाव में कुछ गलत लगा?
            <a class="link" href="#/grievance?e=${esc(d.code)}">शिकायत / रिपोर्ट करें</a>
          </p>
        </div>
      </div>

      ${adminBox}
    </div>
  </section>`;
}

let selectedCandidate = null;

async function renderElection(code, opts = {}) {
  const keepScroll = !!opts.refresh;
  const scrollY = window.scrollY;
  clearPoll();
  setActiveNav('');

  if (!keepScroll) {
    app.innerHTML = `
    <section class="content"><div class="wrap wrap-narrow">
      <div class="skeleton" style="height:16px;width:30%"></div>
      <div class="skeleton" style="height:34px;width:75%;margin-top:14px"></div>
      <div class="skeleton" style="height:16px;width:52%;margin-top:12px"></div>
      <div class="skeleton" style="height:150px;border-radius:18px;margin-top:28px"></div>
      <div class="skeleton" style="height:190px;border-radius:18px;margin-top:16px"></div>
    </div></section>`;
  }

  let d;
  try {
    d = await api('/api/elections/' + encodeURIComponent(code));
  } catch (e) {
    app.innerHTML = `
    <section class="section"><div class="wrap wrap-narrow">
      <div class="empty"><div class="em-ico">${ICON.search}</div>
        <h3>चुनाव नहीं मिला</h3>
        <p>${esc(e.message)} — कोड <b>${esc(code)}</b> जाँचिए या सारे चुनाव देखिए।</p>
        <a class="btn btn-primary" href="#/explore">सारे चुनाव देखें</a>
      </div>
    </div></section>`;
    return;
  }

  selectedCandidate = null;
  app.innerHTML = electionHTML(d);
  window.scrollTo({ top: keepScroll ? scrollY : 0 });
  bindElectionPage(d);
  bindCopyButtons();

  if (!d.closed) {
    let noteMode = 'live';
    const noteText = () => (noteMode === 'live' ? 'कुल वोट और उम्मीदवारों की गिनती मतदान समाप्त होने पर दिखेगी' : 'समाप्ति की स्थिति जाँच रहे हैं · गिनती छिपी');
    const setNote = (txt) => {
      const n = document.getElementById('liveNote');
      if (n) n.textContent = txt;
    };
    const paint = (fresh) => {
      if (!!fresh.closed !== !!d.closed) {
        d = fresh;
        renderElection(d.code, { refresh: true });
        return;
      }
      const box = document.getElementById('resultsBox');
      if (box) box.innerHTML = resultsHTML(fresh);
      // resultsBox ke andar hi liveNote hai — dobara set karo
      setNote(noteText());
      const hv = document.getElementById('headVotes');
      if (hv) hv.textContent = fresh.closed ? fmt(fresh.totalVotes) : '🔒';
      const liveDot = document.getElementById('liveDot');
      if (liveDot) liveDot.classList.add('on');
    };
    const pollOnce = async () => {
      try { paint(await api('/api/elections/' + encodeURIComponent(d.code))); } catch (_) {}
    };
    const started = subscribeElection(d.code, {
      onUpdate: paint,
      onDeleted: () => {
        toast('यह चुनाव हटा दिया गया है।', 'err');
        exploreCache = null;
        location.hash = '#/explore';
      },
      poll: pollOnce,
      onStatus: (st) => {
        noteMode = st === 'live' ? 'live' : 'poll';
        const lbl = document.getElementById('liveLabel');
        if (lbl) lbl.textContent = st === 'live' ? 'गिनती छिपी' : 'फिर जुड़ रहे हैं…';
        setNote(st === 'live' ? noteText() : 'फिर जुड़ रहे हैं…');
      },
    });
    if (!started) {
      noteMode = 'poll';
      // preview/static mode me data isi browser me hai — server ko baar-baar
      // hit karne ka koi matlab nahi. Server mode me 6 sec polling fallback.
      pollTimer = setInterval(pollOnce, window.JANMAT_OFFLINE ? 15000 : 6000);
      if (window.JANMAT_OFFLINE) {
        const lbl0 = document.getElementById('liveLabel');
        if (lbl0) lbl0.textContent = 'लोकल · गिनती छिपी';
      }
    }
    setNote(noteText());
  }
}

function bindElectionPage(d) {
  bindLoginCard(() => renderElection(d.code, { refresh: true }));
  $$('.js-result-card').forEach((b) => b.addEventListener('click', () => { downloadResultCard(d.code, b); }));

  const grid = document.getElementById('voteGrid');
  const voteBtn = document.getElementById('voteBtn');
  const selInfo = document.getElementById('selInfo');

  if (grid) {
    grid.addEventListener('click', (ev) => {
      const card = ev.target.closest('.vcard');
      if (!card) return;
      $$('.vcard', grid).forEach((c) => c.classList.remove('sel'));
      card.classList.add('sel');
      selectedCandidate = card.dataset.id;
      const name = card.querySelector('.vname').textContent;
      if (selInfo) selInfo.innerHTML = `आप चुन रहे हैं: <b>${esc(name)}</b>`;
      if (voteBtn) voteBtn.disabled = false;
    });
  }

  if (voteBtn) {
    voteBtn.addEventListener('click', async () => {
      if (!selectedCandidate) return;
      voteBtn.disabled = true;
      voteBtn.textContent = 'वोट दर्ज हो रहा है…';
      try {
        const res = await api('/api/elections/' + encodeURIComponent(d.code) + '/vote', {
          method: 'POST',
          body: { candidateId: selectedCandidate, deviceId: DEVICE_ID },
        });
        toast(`वोट दर्ज हो गया — ${res.votedFor.name}`, 'ok');
        await renderElection(d.code, { refresh: true });
      } catch (e) {
        toast(e.message, 'err');
        if (e.status === 401 && e.code === 'LOGIN_REQUIRED') {
          state.user = null; store.del('jm_token'); renderNavAuth();
          await renderElection(d.code, { refresh: true });
          return;
        }
        if (e.status === 409 && e.code === 'SAME_PHONE_VOTED' && e.data && e.data.allowOverride) {
          /* 🧬 इस फ़ोन से पहले ही वोट पड़ चुका है — पहले रोको, फिर पूछो */
          voteBtn.disabled = true;
          voteBtn.textContent = 'यह फ़ोन पहले वोट कर चुका है';
          const grid2 = document.getElementById('voteGrid');
          if (grid2 && !document.getElementById('samePhoneBox')) {
            const box = document.createElement('div');
            box.id = 'samePhoneBox';
            box.className = 'guest-note';
            box.style.cssText = 'margin-top:14px;background:#fff7e6;border-color:#ffd9a0;border-left-color:#f59e0b';
            box.innerHTML = `<b>इस फ़ोन से इस चुनाव में पहले ही वोट दिया जा चुका है।</b>
              <span>एक फ़ोन से एक ही वोट मान्य है। अगर यह आपका वोट नहीं है और आप दूसरे व्यक्ति हैं
              (एक ही मॉडल का दूसरा फ़ोन), तो नीचे दबाइए — आपका वोट अलग से दर्ज होगा और डेवलपर को दिखेगा।</span>
              <button type="button" class="btn btn-ghost btn-sm" id="samePhoneOverride" style="margin-top:9px;align-self:flex-start">
                मैं दूसरा व्यक्ति हूँ — मेरा वोट दर्ज करें
              </button>`;
            grid2.parentNode.insertBefore(box, grid2.nextSibling);
            document.getElementById('samePhoneOverride').addEventListener('click', async () => {
              const b2 = document.getElementById('samePhoneOverride');
              b2.disabled = true;
              b2.textContent = 'दर्ज हो रहा है…';
              try {
                await api('/api/elections/' + encodeURIComponent(d.code) + '/vote', {
                  method: 'POST',
                  body: { candidateId: selectedCandidate, deviceId: DEVICE_ID, overrideSamePhone: true },
                });
                toast('वोट दर्ज हो गया (दूसरे व्यक्ति के रूप में)', 'ok');
                await renderElection(d.code, { refresh: true });
              } catch (err2) { toast(err2.message, 'err'); b2.disabled = false; b2.textContent = 'मैं दूसरा व्यक्ति हूँ — मेरा वोट दर्ज करें'; }
            });
          }
          return;
        }
        if (e.status === 409) { await renderElection(d.code, { refresh: true }); return; }
        voteBtn.disabled = false;
        voteBtn.textContent = 'वोट दर्ज करें';
      }
    });
  }

  const toggleClose = document.getElementById('toggleClose');
  if (toggleClose) {
    let armed = false;
    let armTimer = null;
    toggleClose.addEventListener('click', async () => {
      if (!d.closed && !armed) {
        armed = true;
        toggleClose.textContent = 'पक्का? दोबारा क्लिक करें';
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = false; toggleClose.textContent = 'चुनाव समाप्त करें'; }, 4000);
        return;
      }
      clearTimeout(armTimer);
      toggleClose.disabled = true;
      toggleClose.textContent = 'रुकिए…';
      try {
        await api('/api/elections/' + encodeURIComponent(d.code) + '/' + (d.closed ? 'reopen' : 'close'), { method: 'POST' });
        exploreCache = null;
        toast(d.closed ? 'चुनाव फिर से खोल दिया गया।' : 'चुनाव समाप्त — विजेता घोषित!', 'ok');
        await renderElection(d.code, { refresh: true });
      } catch (e) {
        toast(e.message, 'err');
        toggleClose.disabled = false;
        toggleClose.textContent = d.closed ? 'चुनाव फिर खोलें' : 'चुनाव समाप्त करें';
      }
    });
  }

  /* ---------- चुनाव हटाएँ (पूरी साइट से) ---------- */
  const delBtn = document.getElementById('deleteElection');
  if (delBtn) {
    let armedDel = false;
    let armDelTimer = null;
    delBtn.addEventListener('click', async () => {
      if (!armedDel) {
        armedDel = true;
        delBtn.classList.add('armed');
        delBtn.textContent = 'पक्का? दोबारा दबाएँ';
        clearTimeout(armDelTimer);
        armDelTimer = setTimeout(() => {
          armedDel = false;
          delBtn.classList.remove('armed');
          delBtn.textContent = 'चुनाव हटाएँ';
        }, 5000);
        return;
      }
      clearTimeout(armDelTimer);
      delBtn.disabled = true;
      delBtn.textContent = 'हट रहा है…';
      try {
        await api('/api/elections/' + encodeURIComponent(d.code) + '/delete', { method: 'POST' });
        exploreCache = null;
        toast('चुनाव साइट से हटा दिया गया।', 'ok');
        location.hash = '#/settings/elections';
      } catch (e) {
        toast(e.message, 'err');
        delBtn.disabled = false;
        delBtn.textContent = 'चुनाव हटाएँ';
        delBtn.classList.remove('armed');
        armedDel = false;
      }
    });
  }

  /* ---------- बचा समय — सबके लिए हर सेकंड अपडेट ---------- */
  /* ⏱️ सर्वर ने जो "बचा समय" भेजा है उसी से गिनते हैं — फ़ोन की घड़ी ग़लत हो
     तो भी सही रहेगा (पहले Date.now() से गिनते थे → घड़ी आगे होने पर पेज
     बार-बार खुद रीलोड होता रहता था) */
  const startLeft = d.endsAt ? Math.max(0, Number(d.remainingMs) || 0) : 0;
  const tickBase = Date.now();
  const timerEls = $$('[data-left]');
  if (d.endsAt && !d.closed && timerEls.length) {
    let reloaded = false;
    const tick = () => {
      const left = startLeft - (Date.now() - tickBase);
      timerEls.forEach((el) => {
        el.textContent = left > 0 ? fmtLeft(left) : 'समय पूरा';
      });
      if (left <= 0 && !reloaded) {
        reloaded = true;
        clearInterval(countdownTimer);
        countdownTimer = null;
        setTimeout(() => renderElection(d.code, { refresh: true }), 1400);
      }
    };
    clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1000);
  }
}

/* =====================================================================
   LOGIN PAGE
   ===================================================================== */

function renderLogin() {
  setActiveNav('');
  clearPoll();
  const rawNext = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '';
  /* सिर्फ़ site के अंदर के साफ़ route ही स्वीकार करो — crafted login link
     से href तोड़कर DOM-XSS न बन सके। */
  const next = /^[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(rawNext) && !rawNext.includes('//') ? rawNext : '';
  if (state.user) {
    app.innerHTML = `
    <section class="section"><div class="wrap wrap-narrow">
      <div class="panel login-done">
        <div class="avatar big">${esc((state.user.name || '?').charAt(0).toUpperCase())}</div>
        <h2>आप पहले से लॉगिन हैं</h2>
        <p class="muted">${esc(state.user.name)}${state.user.username ? ' <b>(@' + esc(state.user.username) + ')</b>' : ''} के रूप में।</p>
        ${state.user.username ? '' : '<p class="login-note" style="max-width:520px;margin:12px auto 0">⚠ अब लॉगिन username + PIN से होता है। कृपया अभी अपना स्थायी username चुन लें, वरना अगली बार लॉगिन में दिक्कत होगी।</p>'}
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px">
          ${state.user.username ? '' : '<button class="btn btn-primary" id="chooseUsernameBtnLogin" type="button">अपना Username चुनें</button>'}
          <a class="btn ${state.user.username ? 'btn-primary' : 'btn-ghost'}" href="${next ? '#/' + esc(next) : '#/settings'}">आगे बढ़ें</a>
          <button class="btn btn-ghost" id="switchUser">दूसरे खाते से लॉगिन</button>
        </div>
      </div>
    </div></section>`;
    document.getElementById('switchUser').addEventListener('click', async () => {
      await logoutUser();
    });
    const chooseBtn = document.getElementById('chooseUsernameBtnLogin');
    if (chooseBtn) chooseBtn.addEventListener('click', () => { usernamePromptShown = true; showUsernameSetupModal(); });
    return;
  }

  app.innerHTML = `
  <section class="login-page">
    <div class="wrap wrap-narrow">
      <div class="login-hero">
        <div class="kicker" style="color:#ffd08a">लॉगिन</div>
        <h1>Username + PIN, बस।</h1>
        <p>कोई मोबाइल नंबर नहीं, कोई Gmail नहीं, कोई OTP नहीं। आपका नाम प्रोफ़ाइल है; आपकी स्थायी username-ID और गुप्त PIN ही खाते की चाबी है।</p>
      </div>

      ${savedAccountHint ? `<div class="guest-note" style="margin-bottom:14px">
        <b>इस फ़ोन से पहले "${esc(savedAccountHint.name || savedNameHint || '')}" का खाता चला था।</b>
        <span>${savedAccountHint.usernameMasked ? 'उसका username कुछ ऐसा था: <b>' + esc(savedAccountHint.usernameMasked) + '</b>। ' : ''}पूरा username लॉगिन कार्ड पर होता है। अपने आप लॉगिन नहीं होगा — username + PIN आपको खुद लिखना होगा।</span>
        <button type="button" class="btn btn-ghost btn-sm" id="showSavedUsernameHint" style="margin-top:8px;align-self:flex-start">
          Username भूल गए? संकेत / आवेदन देखें
        </button>
      </div>` : ''}

      ${loginCardHTML({
        title: 'Username + PIN से लॉगिन',
        sub: 'चुनाव बनाने और खाता सँभालने के लिए लॉगिन करें। वोट देने के लिए लॉगिन ज़रूरी नहीं — शेयर किया लिंक खोलकर सीधे वोट कीजिए। पहली बार आए हैं तो "नया खाता", और पहले सिर्फ़ नाम से खाता था तो "पुराना खाता" चुनें।',
      })}

      <div class="panel" style="margin-top:16px">
        <div class="login-rules">
          <div>${ICON.shield}<span><b>Username सिर्फ़ एक का:</b> जैसे @pawan_verma एक बार किसी ने ले लिया, तो वही username दूसरा कोई नहीं ले सकता — फॉर्म उसी समय "पहले से उपयोग में है" बता देगा।</span></div>
          <div>${ICON.user}<span><b>नाम सबके अलग-अलग नहीं चाहिए:</b> दस "रमेश" हो सकते हैं; पहचान उनके अलग username से होगी, नाम सिर्फ़ प्रोफ़ाइल में दिखेगा।</span></div>
          <div>${ICON.ballot}<span><b>मेहमान वोट भी चलेगा:</b> लिंक खोलकर बिना खाते वोट दिया जा सकता है। बाद में उसी फ़ोन से signup होने पर वोट उसी username से जुड़ जाएगा, गिनती एक ही रहेगी।</span></div>
          <div>${ICON.clock}<span><b>एक फ़ोन = एक सीधा signup:</b> साझा फ़ोन पर दूसरा खाता Team Janmat की मंज़ूरी (appeal) से बनेगा। हर खाता रोज़ अधिकतम 2 चुनाव बना सकता है।</span></div>
          <div>${ICON.star || ICON.ballot}<span><b>PIN भूल गए?</b> लॉगिन कार्ड के रिकवरी कोड से नया PIN बनेगा — कोड हमेशा वही रहता है। <b>कार्ड ही खो गया?</b> “खाता वापसी आवेदन” भेजें — मंज़ूरी के बाद उसी पुराने खाते पर नया PIN लगेगा। <b>Username भूल गए?</b> आवेदन भेजें — Team Janmat जाँचकर मंज़ूरी देगी, तब तक Pending रहेगा।</span></div>
        </div>
        <p class="login-note">आगे बढ़ने पर आप <a href="#/disclaimer">डिस्क्लेमर व नियम</a> स्वीकार करते हैं।</p>
      </div>
    </div>
  </section>`;

  bindLoginCard(() => { location.hash = next ? '#/' + next : '#/settings'; });
}

/* =====================================================================
   SETTINGS  (profile + my elections + my votes)
   ===================================================================== */

const SETTINGS_ROWS = [
  { id: 'profile',    icon: 'user',    title: 'मेरी प्रोफ़ाइल',        sub: 'नाम, username, तारीख़ और आँकड़े', href: '#/settings/profile' },
  { id: 'elections',  icon: 'ballot',  title: 'मेरे चुनाव',            sub: 'आपके बनाए चुनाव — चालू / समाप्त, बंद करें', href: '#/settings/elections' },
  { id: 'votes',      icon: 'star',    title: 'मेरे वोट',              sub: 'आपने किन चुनावों में किसको वोट दिया', href: '#/settings/votes' },
  { id: 'appearance', icon: 'gear',    title: 'दिखावट और डार्क मोड',   sub: 'लाइट, डार्क या सिस्टम थीम', href: '#/settings/appearance' },
  { id: 'guide',      icon: 'book',    title: 'गाइड — कैसे काम करता है', sub: 'बनाना, शेयर करना, वोट डालना और परिणाम', href: '#/how' },
  { id: 'privacy',    icon: 'shield',  title: 'गोपनीयता नीति',        sub: 'आपका डेटा क्या जाता है, कहाँ रहता है', href: '#/privacy' },
  { id: 'terms',      icon: 'doc',     title: 'नियम व शर्तें',         sub: 'उपयोग की शर्तें और ज़िम्मेदारियाँ', href: '#/terms' },
  { id: 'disclaimer', icon: 'warn',    title: 'डिस्क्लेमर',            sub: 'यह सरकारी/निर्वाचन-आयोग मंच नहीं है', href: '#/disclaimer' },
  { id: 'account',    icon: 'lock',    title: 'खाता और सुरक्षा',       sub: 'PIN बदलना, लॉगआउट, खाता हटाना', href: '#/settings/account' },
];

function rowIcon(name, size) {
  const svg = ICON[name] || ICON.gear;
  const px = size || 20;
  return svg.replace(/width="\d+"/, 'width="' + px + '"').replace(/height="\d+"/, 'height="' + px + '"');
}

function settingsRowHTML(r) {
  return `
  <a class="set-row" href="${r.href}">
    <span class="set-row-ico">${rowIcon(r.icon, 20)}</span>
    <span class="set-row-text">
      <b>${r.title}</b>
      <span>${r.sub}</span>
    </span>
    <svg class="set-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
  </a>`;
}

async function renderSettings(tab) {
  setActiveNav('settings');
  clearPoll();
  tab = tab || 'main';

  if (!state.user) {
    app.innerHTML = `
    <section class="section"><div class="wrap wrap-narrow">
      <div class="kicker">सेटिंग्स</div>
      <h2 style="font-size:clamp(24px,3.4vw,34px);letter-spacing:-.025em">सेटिंग्स और मेरा खाता</h2>
      <p class="muted" style="margin:9px 0 22px">अपने चुनाव, अपने वोट और डार्क मोड देखने के लिए लॉगिन करें।</p>
      ${loginCardHTML({ title: 'लॉगिन करें' })}
      <div class="set-list" style="margin-top:18px">
        ${settingsRowHTML(SETTINGS_ROWS[3])}${settingsRowHTML(SETTINGS_ROWS[4])}${settingsRowHTML(SETTINGS_ROWS[5])}${settingsRowHTML(SETTINGS_ROWS[7])}
      </div>
    </div></section>`;
    bindLoginCard(() => renderSettings('main'));
    return;
  }

  let data = null;
  let loadErr = null;
  try {
    data = await api('/api/me/overview');
    state.quota = data.quota;
    state.user = data.user;
  } catch (e) { loadErr = e.message; }

  const first = (state.user.name || '?').trim().charAt(0).toUpperCase();
  let body = '';

  if (tab === 'appearance') body = settingsAppearanceHTML();
  else if (tab === 'account') body = settingsAccountHTML();
  else if (loadErr) body = `<div class="empty"><div class="em-ico">${ICON.warn}</div><h3>लोड नहीं हो पाया</h3><p>${esc(loadErr)}</p></div>`;
  else if (tab === 'profile') body = settingsProfileHTML(data);
  else if (tab === 'elections') body = settingsElectionsHTML(data);
  else if (tab === 'votes') body = settingsVotesHTML(data);
  else body = `
    <div class="set-list">
      ${SETTINGS_ROWS.map(settingsRowHTML).join('')}
    </div>`;

  app.innerHTML = `
  <section class="section">
    <div class="wrap">
      <div class="settings-head">
        <a class="avatar xl" href="#/settings/profile" title="प्रोफ़ाइल">${esc(first)}</a>
        <div>
          <div class="kicker">${tab === 'main' ? 'सेटिंग्स' : 'मेरा खाता'}</div>
          <h2>${esc(state.user.name)}</h2>
          <p class="muted">${state.user.username ? '<b>@' + esc(state.user.username) + '</b> · ' : '<b style="color:#b45309">Username अभी नहीं चुना</b> · '}${data ? esc(data.elections.length) + ' चुनाव · ' + esc(data.votes.length) + ' वोट' : 'सेटिंग्स'} · ${getThemePref() === 'dark' ? 'डार्क मोड' : getThemePref() === 'light' ? 'लाइट मोड' : 'सिस्टम थीम'}</p>
        </div>
        <div class="settings-head-actions">
          <a class="btn btn-primary btn-sm" href="#/create">＋ नया चुनाव</a>
          <button class="btn btn-ghost btn-sm" id="logoutBtn">लॉगआउट</button>
        </div>
      </div>

      ${tab !== 'main' ? `<a class="back-link" href="#/settings">← सभी सेटिंग्स</a>` : ''}
      ${body}
    </div>
  </section>`;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);
  const logoutBtn2 = document.getElementById('logoutBtn2');
  if (logoutBtn2) logoutBtn2.addEventListener('click', logoutUser);
  const redl = document.getElementById('redownloadCard');
  if (redl) redl.addEventListener('click', () => openLoginCard(state.user && state.user.name, { first: false, username: state.user && state.user.username }));
  const chooseUsernameBtn = document.getElementById('chooseUsernameBtn');
  if (chooseUsernameBtn) chooseUsernameBtn.addEventListener('click', () => { usernamePromptShown = true; showUsernameSetupModal(); });

  const newPwEl = document.getElementById('newPw');
  const newPw2El = document.getElementById('newPw2');
  [newPwEl, newPw2El].forEach((el) => {
    if (el) el.addEventListener('input', () => { el.value = String(el.value).replace(/[^0-9]/g, '').slice(0, 10); });
  });
  const changePwBtn = document.getElementById('changePwBtn');
  if (changePwBtn) changePwBtn.addEventListener('click', async () => {
    const oldPassword = document.getElementById('oldPw').value;
    const newPassword = document.getElementById('newPw').value;
    const newPassword2 = document.getElementById('newPw2').value;
    const pinErr = pinErrorClient(newPassword, state.user && state.user.username);
    if (!oldPassword) return toast('मौजूदा PIN/पासवर्ड लिखें', 'err');
    if (pinErr) return toast(pinErr, 'err');
    if (newPassword !== newPassword2) return toast('दोनों नए PIN एक जैसे नहीं हैं।', 'err');
    changePwBtn.disabled = true;
    changePwBtn.textContent = 'बदल रहे हैं…';
    try {
      await api('/api/auth/password', { method: 'POST', body: { oldPassword, newPassword } });
      document.getElementById('oldPw').value = '';
      document.getElementById('newPw').value = '';
      document.getElementById('newPw2').value = '';
      toast('PIN बदल गया। अगली बार नया PIN लगेगा।', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    }
    changePwBtn.disabled = false;
    changePwBtn.textContent = 'PIN बदलें';
  });

  const recGenBtn = document.getElementById('recGenBtn');
  if (recGenBtn) recGenBtn.addEventListener('click', async () => {
    const pwEl = document.getElementById('recGenPw');
    const errEl = document.getElementById('recGenError');
    const showErr = (m) => { if (errEl) { errEl.textContent = '⚠ ' + m; errEl.hidden = false; } toast(m, 'err'); };
    if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
    if (!pwEl || !pwEl.value) return showErr('कारण: मौजूदा PIN लिखा ही नहीं। पहले अपना मौजूदा PIN लिखें — बिना PIN के नया कोड नहीं बनेगा।');
    recGenBtn.disabled = true;
    recGenBtn.textContent = 'कोड बना रहे हैं…';
    try {
      const res = await api('/api/auth/recovery-code', { method: 'POST', body: { currentPassword: pwEl.value } });
      pwEl.value = '';
      toast('नया रिकवरी कोड बन गया — पुराना कार्ड अब नहीं चलेगा। नया कार्ड सँभाल लें।', 'ok');
      openLoginCard(state.user && state.user.name, { first: true, recoveryCode: res.recoveryCode, username: state.user && state.user.username });
    } catch (e) {
      showErr(e.message);
    }
    recGenBtn.disabled = false;
    recGenBtn.textContent = 'नया रिकवरी कोड बनाएँ';
  });

  bindCopyButtons();

  // theme buttons
  $$('[data-theme-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.themeSet);
      $$('[data-theme-set]').forEach((b) => b.classList.toggle('sel', b.dataset.themeSet === getThemePref()));
      const note = document.getElementById('themeNote');
      if (note) note.textContent = btn.dataset.themeSet === 'dark' ? 'डार्क मोड चालू है' : btn.dataset.themeSet === 'light' ? 'लाइट मोड चालू है' : 'सिस्टम सेटिंग के हिसाब से बदलेगा';
      toast('थीम बदल गई', 'ok');
    });
  });
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('sel', b.dataset.themeSet === getThemePref()));

  // delete account
  const delBtn = document.getElementById('deleteAccountBtn');
  if (delBtn) {
    let armed = false;
    delBtn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = 'पक्का? दोबारा दबाएँ — खाता हट जाएगा';
        setTimeout(() => { armed = false; delBtn.textContent = 'मेरा खाता हटाएँ'; }, 5000);
        return;
      }
      delBtn.disabled = true;
      try {
        await api('/api/account/delete', { method: 'POST', body: { confirm: true } });
        state.user = null; state.token = null; state.quota = null;
        store.del('jm_token');
        renderNavAuth();
        toast('खाता हटा दिया गया। आपके वोटों की गिनती बरकरार है (बिना नाम के)।', 'ok');
        location.hash = '#/';
      } catch (e) {
        toast(e.message, 'err');
        delBtn.disabled = false;
      }
    });
  }

  if (tab === 'elections') {
    $$('[data-count-to]').forEach((el) => {
      el.textContent = fmtLeft(Number(el.dataset.countTo) || 0);
    });
    $$('[data-delete]').forEach((btn) => {
      let armed = false;
      let armT = null;
      btn.addEventListener('click', async () => {
        const code = btn.dataset.delete;
        if (!armed) {
          armed = true;
          btn.textContent = 'पक्का? दोबारा दबाएँ';
          armT = setTimeout(() => { armed = false; btn.textContent = 'हटाएँ'; }, 5000);
          return;
        }
        clearTimeout(armT);
        btn.disabled = true;
        btn.textContent = 'हट रहा है…';
        try {
          await api('/api/elections/' + encodeURIComponent(code) + '/delete', { method: 'POST' });
          exploreCache = null;
          toast('चुनाव हटा दिया गया।', 'ok');
          renderSettings('elections');
        } catch (e) {
          toast(e.message, 'err');
          btn.disabled = false;
          btn.textContent = 'हटाएँ';
          armed = false;
        }
      });
    });
    $$('[data-manage]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const code = btn.dataset.manage;
        btn.disabled = true;
        try {
          await api('/api/elections/' + code + '/' + btn.dataset.action, { method: 'POST' });
          toast(btn.dataset.action === 'close' ? 'चुनाव समाप्त — विजेता घोषित!' : 'चुनाव दोबारा खोल दिया', 'ok');
          renderSettings('elections');
        } catch (e) {
          toast(e.message, 'err');
          btn.disabled = false;
        }
      });
    });
  }
}

function settingsAppearanceHTML() {
  const cur = getThemePref();
  const opts = [
    { id: 'light', title: 'लाइट', desc: 'दिन में साफ़ और चमकीला', demo: 'light' },
    { id: 'dark', title: 'डार्क', desc: 'रात में आँखों के लिए आरामदायक', demo: 'dark' },
    { id: 'system', title: 'सिस्टम', desc: 'फ़ोन/लैपटॉप की सेटिंग के हिसाब से', demo: 'system' },
  ];
  return `
  <div class="panel">
    <div class="section-title"><h2 style="font-size:18px">थीम चुनें</h2></div>
    <p class="muted" style="font-size:13.6px;margin-bottom:16px">आपकी पसंद इसी डिवाइस पर याद रखी जाएगी।</p>
    <div class="theme-grid">
      ${opts.map((o) => `
        <button class="theme-opt ${cur === o.id ? 'sel' : ''}" data-theme-set="${o.id}">
          <span class="theme-prev ${o.demo}">
            <i class="tp-bar"></i><i class="tp-line"></i><i class="tp-line short"></i><i class="tp-btn"></i>
          </span>
          <b>${o.title}</b>
          <span>${o.desc}</span>
        </button>`).join('')}
    </div>
    <p class="quota-note" id="themeNote" style="margin-top:14px">${cur === 'dark' ? 'डार्क मोड चालू है' : cur === 'light' ? 'लाइट मोड चालू है' : 'सिस्टम सेटिंग के हिसाब से बदलेगा'}</p>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="section-title"><h2 style="font-size:18px">सुविधा</h2></div>
    <ul class="info-list">
      <li><b>भाषा</b><span>हिंदी (देवनागरी)</span></li>
      <li><b>मतदान जानकारी</b><span>कुल वोट और उम्मीदवारों की गिनती मतदान समाप्त होने पर खुलती है</span></li>
      <li><b>फ़ॉन्ट साइज़</b><span>साइट के साथ (मोबाइल-फ्रेंडली)</span></li>
    </ul>
  </div>`;
}

function settingsAccountHTML() {
  return `
  <div class="panel">
    <div class="section-title"><h2 style="font-size:18px">खाता</h2></div>
    <ul class="info-list">
      <li><b>प्रोफ़ाइल नाम</b><span>${esc(state.user.name)}</span></li>
      <li><b>Username (Login-ID)</b><span>${state.user.username ? '<b>@' + esc(state.user.username) + '</b> · स्थायी, बदला नहीं जा सकता' : '<b style="color:#b45309">अभी नहीं चुना</b>'}</span></li>
      <li><b>लॉगिन का तरीक़ा</b><span>Username + गुप्त PIN (मोबाइल/Gmail/OTP नहीं)</span></li>
      <li><b>सदस्यता</b><span>${esc(fullDate(state.user.createdAt))}</span></li>
    </ul>
    ${state.user.username ? '' : '<div class="guest-note" style="margin-top:14px"><b>आपका Username अभी बाकी है।</b><span>अब लॉगिन username + PIN से होता है — कृपया अभी चुन लें। आपका नाम, चुनाव और वोट वैसे ही रहेंगे।</span><button class="btn btn-primary btn-sm" id="chooseUsernameBtn" type="button" style="margin-top:8px;align-self:flex-start">Username चुनें</button></div>'}
    <div class="pw-change">
      <h3 style="font-size:15px;margin:18px 0 6px">🔐 PIN बदलें</h3>
      <p class="muted small" style="margin-bottom:10px">मौजूदा PIN/पासवर्ड डालकर नया 6–10 अंकों का PIN रखें। बाकी सब जगह से आप लॉगआउट हो जाएँगे। रिकवरी कोड वही पुराना चलेगा।</p>
      <input id="oldPw" type="password" placeholder="मौजूदा PIN / पुराना पासवर्ड" maxlength="64" autocomplete="current-password" aria-label="मौजूदा PIN या पासवर्ड" />
      <input id="newPw" type="password" inputmode="numeric" placeholder="नया PIN (6–10 अंक)" maxlength="10" autocomplete="new-password" aria-label="नया PIN" />
      <input id="newPw2" type="password" inputmode="numeric" placeholder="नया PIN दोबारा" maxlength="10" autocomplete="new-password" aria-label="नया PIN दोबारा" />
      <button class="btn btn-dark" id="changePwBtn" type="button">PIN बदलें</button>
    </div>
    <div class="pw-change">
      <h3 style="font-size:15px;margin:18px 0 6px">🔑 नया रिकवरी कोड / कार्ड बनाएँ</h3>
      <p class="muted small" style="margin-bottom:10px">लॉगिन कार्ड (image) खो गया या delete हो गया? अपना मौजूदा PIN डालकर नया कोड बना लीजिए — <b>नया कोड बनते ही पुराना कार्ड बंद हो जाएगा</b>, फिर नया कार्ड डाउनलोड करके सँभाल लें। कार्ड सही-सलामत है तो कुछ करने की ज़रूरत नहीं — कोड वही चलता रहेगा।</p>
      <input id="recGenPw" type="password" placeholder="मौजूदा PIN / पासवर्ड" maxlength="64" autocomplete="current-password" aria-label="नए रिकवरी कोड के लिए मौजूदा PIN" />
      <button class="btn btn-dark" id="recGenBtn" type="button">नया रिकवरी कोड बनाएँ</button>
      <div id="recGenError" class="auth-error" role="alert" hidden></div>
    </div>
    <p class="muted small" style="margin-top:14px">नोट: दोबारा डाउनलोड किए कार्ड पर रिकवरी कोड नहीं छपता — कोड सिर्फ़ कार्ड बनते समय मिलता है। कार्ड खो गया हो तो ऊपर से नया कोड बना लें।</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
      <button class="btn btn-primary" id="redownloadCard">🎴 मेरा लॉगिन कार्ड फिर डाउनलोड करें</button>
      <button class="btn btn-ghost" id="logoutBtn2">लॉगआउट करें</button>
      <a class="btn btn-ghost" href="#/privacy">गोपनीयता नीति</a>
      <a class="btn btn-ghost" href="#/terms">नियम व शर्तें</a>
    </div>
  </div>

  <div class="panel danger-zone" style="margin-top:16px">
    <div class="section-title"><h2 style="font-size:18px">खतरे का क्षेत्र</h2></div>
    <p class="muted" style="font-size:13.6px;margin-bottom:6px">
      खाता हटाने पर आपका नाम और पहचान हट जाती है। आपके दिए वोटों की <b>गिनती बरकरार</b> रहती है
      (ताकि चुनाव के परिणाम सही रहें), पर वो किसी नाम से नहीं जुड़े रहेंगे।
    </p>
    <p class="muted" style="font-size:13px;margin-bottom:14px">आपके बनाए चुनाव और उनके परिणाम मिटेंगे नहीं — वे सार्वजनिक रूप से जारी रहेंगे।</p>
    <button class="btn btn-danger" id="deleteAccountBtn">मेरा खाता हटाएँ</button>
  </div>`;

  // logoutBtn2 bind (baad me settings ke generic binding ke baad)
}

function settingsProfileHTML(data) {
  const q = data.quota || { limit: 2, used: 0, remaining: 2, resetsAt: 0 };
  const pct = Math.min(100, Math.round((q.used / q.limit) * 100));
  return `
  <div class="panel" style="margin-bottom:16px">
    <div class="section-title"><h2 style="font-size:17px">मेरी पहचान</h2></div>
    <ul class="info-list">
      <li><b>प्रोफ़ाइल नाम</b><span>${esc(state.user.name)}</span></li>
      <li><b>Username</b><span>${state.user.username ? '<b>@' + esc(state.user.username) + '</b>' : '<b style="color:#b45309">अभी नहीं चुना</b>'}</span></li>
      <li><b>जुड़े</b><span>${esc(fullDate(state.user.createdAt))}</span></li>
    </ul>
    ${state.user.username ? '<p class="muted small" style="margin-top:10px">यही username आपकी स्थायी login-ID है — पूरी Janmat में यह सिर्फ़ आपका है।</p>' : '<button class="btn btn-primary btn-sm" id="chooseUsernameBtn" type="button" style="margin-top:12px">अपना Username चुनें</button>'}
  </div>
  <div class="settings-grid">
    <div class="panel">
      <div class="section-title"><h2 style="font-size:17px">आज की गतिविधि</h2></div>
      <div class="mini-stats">
        <div><b>${data.elections.length}</b><span>कुल चुनाव बनाए</span></div>
        <div><b>${data.votes.length}</b><span>कुल वोट दिए</span></div>
        <div><b>${q.remaining}</b><span>आज बचे चुनाव</span></div>
      </div>
      <div class="quota-box" style="margin-top:16px">
        <div class="quota-top"><div>${ICON.ballot} <b>आज की सीमा</b> — ${q.used}/${q.limit}</div><div class="quota-left">${q.remaining > 0 ? `${q.remaining} और बना सकते हैं` : 'सीमा पूरी'}</div></div>
        <div class="quota-track"><i style="width:${pct}%"></i></div>
        <div class="quota-note">अगला मौका: ${esc(fullDate(q.resetsAt))} (IST)</div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
        <a class="btn btn-primary btn-sm" href="#/create">＋ नया चुनाव</a>
        <a class="btn btn-ghost btn-sm" href="#/settings/elections">मेरे चुनाव</a>
      </div>
    </div>

    <div class="panel">
      <div class="section-title"><h2 style="font-size:17px">नियम एक नज़र में</h2></div>
      <ul class="info-list">
        <li><b>लॉगिन</b><span>Username + 6–10 अंकों के PIN से</span></li>
        <li><b>वोट नियम</b><span>एक डिवाइस = एक वोट प्रति चुनाव</span></li>
        <li><b>चुनाव सीमा</b><span>1 दिन में अधिकतम ${q.limit} चुनाव</span></li>
        <li><b>गोपनीयता</b><span>किसने किसको वोट दिया — सिर्फ़ डेवलपर देख सकता है</span></li>
      </ul>
      <div class="legal-strip" style="margin-top:14px">${ICON.shield}<span><a href="#/disclaimer">डिस्क्लेमर व नियम पढ़ें</a> — यह सरकारी चुनाव मंच नहीं है।</span></div>
    </div>
  </div>`;
}

function settingsElectionsHTML(data) {
  if (!data.elections.length) {
    return `<div class="empty"><div class="em-ico">${ICON.box}</div><h3>अभी आपने कोई चुनाव नहीं बनाया</h3>
      <p>दो मिनट में अपना पहला चुनाव बनाइए।</p><a class="btn btn-primary" href="#/create">चुनाव बनाएँ</a></div>`;
  }
  return `
  <div class="my-list">
    ${data.elections.map((e) => {
      const lead = e.leading;
      return `
      <div class="my-item">
        <div class="my-item-main">
          <div class="my-item-top">
            ${e.closed ? '<span class="badge closed">परिणाम घोषित</span>' : '<span class="badge live"><i></i> चालू</span>'}
            <span class="badge">${esc(e.type)}</span>
            <span class="code-chip">${esc(e.code)}</span>
          </div>
          <h3>${esc(e.title)}</h3>
          <p class="muted small">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)} · ${esc(timeAgo(e.createdAt))}</p>
          <p class="my-leading">${!e.closed ? 'कुल वोट और परिणाम मतदान समाप्त होने पर दिखेंगे' : (lead && lead.votes ? `अंतिम गिनती में सबसे अधिक: <b>${esc(lead.name)}</b> — ${fmt(lead.votes)} वोट (${lead.percent}%)` : 'इस चुनाव में कोई वोट नहीं पड़ा')}</p>
          ${e.endsAt ? `<p class="my-timer">${ICON.clock} ${e.closed ? 'समाप्त: ' + esc(fullDate(e.endsAt)) : '<b data-count-to="' + (e.remainingMs || 0) + '">' + esc(fmtLeft(e.remainingMs || 0)) + '</b> · समाप्ति ' + esc(fullDate(e.endsAt))}</p>` : ''}
        </div>
        <div class="my-item-actions">
          <div class="my-votes"><b>${e.closed ? fmt(e.totalVotes) : '🔒'}</b><span>${e.closed ? 'वोट' : 'वोट छिपे'}</span></div>
          <a class="btn btn-ghost btn-sm" href="#/e/${e.code}">देखें</a>
          <button class="btn ${e.closed ? 'btn-ghost' : 'btn-danger'} btn-sm" data-manage="${e.code}" data-action="${e.closed ? 'reopen' : 'close'}"
            ${(!e.closed && !e.canDelete) || (e.closed && e.timeUp) ? 'disabled title="' + (e.timeUp ? 'समय पूरा — दोबारा नहीं खुलेगा' : 'तय समय से पहले बंद नहीं कर सकते') + '"' : ''}>${e.closed ? (e.timeUp ? 'समाप्त' : 'फिर खोलें') : 'समाप्त करें'}</button>
          <button class="btn btn-ghost btn-sm" data-delete="${e.code}" ${e.canDelete ? '' : 'disabled title="समय पूरा होने के बाद ही हटा सकते हैं"'}>हटाएँ</button>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function settingsVotesHTML(data) {
  if (!data.votes.length) {
    return `<div class="empty"><div class="em-ico">${ICON.box}</div><h3>आपने अभी किसी चुनाव में वोट नहीं दिया</h3>
      <p>चल रहे चुनावों में अपना वोट दर्ज कीजिए।</p><a class="btn btn-primary" href="#/explore">चुनाव खोजें</a></div>`;
  }
  return `
  <div class="my-list">
    ${data.votes.map((v) => `
      <div class="my-item">
        <div class="my-item-main">
          <div class="my-item-top">
            ${v.closed ? '<span class="badge closed">समाप्त</span>' : '<span class="badge live"><i></i> चालू</span>'}
            <span class="code-chip">${esc(v.code)}</span>
          </div>
          <h3>${esc(v.title)}</h3>
          <p class="muted small">${esc(v.gram)} · ${esc(v.district)} · ${esc(v.state)}</p>
          <p class="my-leading">आपने वोट दिया: ${v.candidate ? `<b>${esc(v.candidate.name)}</b>` : '—'} · ${esc(timeAgo(v.at))}</p>
        </div>
        <div class="my-item-actions">
          <div class="voted-sym">${symbolSVG(v.candidate ? v.candidate.symbol : 'diya', 26)}</div>
          <a class="btn btn-ghost btn-sm" href="#/e/${v.code}">${v.closed ? 'परिणाम</a>' : 'चुनाव देखें</a>'}
        </div>
      </div>`).join('')}
  </div>`;
}

/* =====================================================================
   DEVELOPER PANEL
   ===================================================================== */

let devData = null;
let devTab = 'active';

/* सार्वजनिक UI में इस प्रवेश का कोई बटन/लिंक नहीं रखा गया है। */
const OWNER_GATE_KEY = 'jm_owner_gate_v1';
function ownerGateOn() {
  try { return sessionStorage.getItem(OWNER_GATE_KEY) === '1'; }
  catch (_) { return !!window.__jmOwnerGate; }
}
function ownerGateEnable() {
  window.__jmOwnerGate = true;
  try { sessionStorage.setItem(OWNER_GATE_KEY, '1'); } catch (_) {}
}
function ownerGateClear() {
  window.__jmOwnerGate = false;
  try { sessionStorage.removeItem(OWNER_GATE_KEY); } catch (_) {}
}
function ownerGateAllowed() {
  return !!state.devToken || ownerGateOn();
}
function ownerGateHome() {
  if (typeof stopDevLive === 'function') { try { stopDevLive(); } catch (_) {} }
  try { history.replaceState(null, '', pageBase() + '#/'); }
  catch (_) { try { location.hash = '#/'; } catch (__) {} }
  try { window.scrollTo({ top: 0 }); } catch (_) {}
  return safeRender('home', () => renderHome());
}
function bindBrandOwnerGate() {
  const brand = document.querySelector('.brand');
  if (!brand || brand.__ownerGateBound) return;
  brand.__ownerGateBound = true;
  let taps = [];
  brand.addEventListener('click', (ev) => {
    const now = Date.now();
    taps = taps.filter((t) => now - t < 2600);
    taps.push(now);
    if (taps.length >= 5) {
      taps = [];
      ev.preventDefault();
      ev.stopPropagation();
      ownerGateEnable();
      if (String(location.hash || '').startsWith('#/developer')) route();
      else location.hash = '#/developer';
    }
  });
}

async function renderDeveloper() {
  setActiveNav('');
  clearPoll();
  stopDevLive();

  if (!state.devToken) return renderDevLogin();

  try {
    devData = await api('/api/dev/overview');
  } catch (e) {
    if (e.status === 401) {
      state.devToken = null;
      store.del('jm_dev_token');
      return renderDevLogin();
    }
    app.innerHTML = `<section class="section"><div class="wrap"><div class="empty"><div class="em-ico">${ICON.warn}</div><h3>लोड नहीं हो पाया</h3><p>${esc(e.message)}</p></div></div></section>`;
    return;
  }

  const s = devData.stats;
  app.innerHTML = `
  <section class="dev-page">
    <div class="wrap">
      <div class="dev-head">
        <div>
          <div class="kicker" style="color:#ffd08a">डेवलपर कंसोल</div>
          <h1>पूरा सिस्टम, एक जगह</h1>
          <p>यहाँ सिर्फ़ आप (डेवलपर) देख सकते हैं — किस यूज़र ने क्या चुनाव बनाया और किसने किसको वोट दिया।</p>
        </div>
        <div class="dev-head-actions">
          <span class="storage-chip">${s.storage === 'redis' ? 'Upstash Redis · स्थायी' : 'लोकल फ़ाइल · db.json'}</span>
          <button class="btn btn-ghost btn-sm" id="devExit">← पैनल से बाहर</button>
          <button class="btn btn-ghost btn-sm" id="devLogout">डेवलपर लॉगआउट</button>
        </div>
      </div>

      <div class="dev-stats" id="devStats">${devStatsHTML()}</div>

      <div class="tabs dark">
        <button class="tab ${devTab === 'active' ? 'active' : ''}" data-devt="active">चालू चुनाव (${devData.elections.filter((e) => !e.closed).length})</button>
        <button class="tab ${devTab === 'elections' ? 'active' : ''}" data-devt="elections">सभी चुनाव (${devData.elections.length})</button>
        <button class="tab ${devTab === 'votes' ? 'active' : ''}" data-devt="votes">सभी वोट (${devData.votes.length})</button>
        <button class="tab ${devTab === 'users' ? 'active' : ''}" data-devt="users">यूज़र्स (${devData.users.length})</button>
        <button class="tab ${devTab === 'complaints' ? 'active' : ''}" data-devt="complaints">शिकायतें (${(devData.usage && devData.usage.openComplaints) || 0})</button>
        <button class="tab ${devTab === 'applications' ? 'active' : ''}" data-devt="applications">खाता आवेदन (${(devData.usage && devData.usage.pendingApplications) || 0})</button>
        <button class="tab ${devTab === 'summary' ? 'active' : ''}" data-devt="summary">सारांश</button>
      </div>

      <div class="dev-live-card" id="devLiveCard">
        <div class="dev-live-head">
          <span class="dev-live-dot" id="devLiveDot"></span>
          <b>लाइव फ़ीड</b>
          <span class="muted small" id="devLiveStatus">जुड़ रहे हैं…</span>
          <span class="dev-live-count" id="devLiveCount">0</span>
        </div>
        <div class="dev-live-list" id="devLiveList">
          <p class="muted small">जैसे ही कोई वोट डालेगा, यहाँ तुरंत दिखेगा — नाम, चुनाव और किसको वोट दिया।</p>
        </div>
      </div>

      <div id="devBody">${devBodyHTML()}</div>
    </div>
  </section>
  <div id="devModal" class="sym-modal"></div>`;

  /* 🚪 पैनल से बाहर — इतिहास (history) में पैनल की entry हटा देता है,
     वरना फ़ोन का Back बटन बार-बार पैनल पर लौटा देता था (यही असली बग था)। */
  const devExit = document.getElementById('devExit');
  if (devExit) devExit.addEventListener('click', () => {
    stopDevLive();
    try { location.replace(pageBase() + '#/'); } catch (_) { location.hash = '#/'; }
  });

  document.getElementById('devLogout').addEventListener('click', async () => {
    try { await api('/api/dev/logout', { method: 'POST' }); } catch (_) {}
    state.devToken = null;
    store.del('jm_dev_token');
    ownerGateClear();
    devData = null;
    stopDevLive();
    /* लॉगआउट के बाद भी वापस पैनल पर न आए — इस entry को होम से बदल दो */
    try { location.replace(pageBase() + '#/'); } catch (_) { renderDevLogin(); }
  });

  /* 🔗 पैनल खुला है तो कोई भी अंदरूनी लिंक "replace" से खुले — ताकि Back
     दबाने पर पैनल दोबारा न खिंचे। (होम/खोजें/गाइड/चुनाव — सब) */
  if (!window.__devLinkFix) {
    window.__devLinkFix = true;
    document.addEventListener('click', (ev) => {
      try {
        if (!String(location.hash || '').startsWith('#/developer')) return;
        const el = ev.target && ev.target.closest ? ev.target.closest('a[href^="#/"]') : null;
        if (!el) return;
        const href = el.getAttribute('href') || '';
        if (!href || href.startsWith('#/developer')) return;
        ev.preventDefault();
        stopDevLive();
        location.replace(pageBase() + href);
      } catch (_) {}
    }, true);
  }

  $$('[data-devt]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      devTab = btn.dataset.devt;
      $$('[data-devt]').forEach((b) => b.classList.toggle('active', b === btn));
      if (devTab === 'complaints') await loadDevComplaints();
      if (devTab === 'applications') await loadDevApplications();
      document.getElementById('devBody').innerHTML = devBodyHTML();
      bindDevBody();
    });
  });

  bindDevBody();
  startDevLive();
}


/* =====================================================================
   📊 उपयोग मीटर — Upstash 5,00,000 commands/महीना और 250 MB की असली स्थिति
   (गिनती इस अपडेट के बाद से — हर सफल Redis command गिनी जाती है)
   ===================================================================== */
function bytesHuman(n) {
  const b = Number(n) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(2) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function meterBar(pct, danger) {
  const p = Math.max(0, Math.min(100, pct));
  const color = p >= 85 ? '#e5484d' : p >= 60 ? '#f0a020' : '#2fa84f';
  return `<div class="meter"><i style="width:${p.toFixed(1)}%;background:${color}"></i></div>`;
}

function usageMeterHTML() {
  const u = (devData && devData.usage) || null;
  if (!u) return '';
  const cmdPct = (u.commands / (u.commandQuota || 500000)) * 100;
  const dbPct = (u.dbBytes / (u.dbBytesQuota || 1)) * 100;
  const safe = cmdPct < 60;
  return `
  <div class="dev-card" style="margin-bottom:18px">
    <div class="dev-card-head">
      <h3>📊 उपयोग मीटर — ${esc(u.monthKey || '')}</h3>
      <span class="storage-chip">${safe ? 'सुरक्षित' : 'ध्यान दें'}</span>
    </div>
    <div class="dev-grid2" style="gap:14px">
      <div>
        <div class="muted small" style="margin-bottom:6px">
          <b>${fmt(u.commands)}</b> / ${fmt(u.commandQuota)} commands (${cmdPct.toFixed(2)}%)
        </div>
        ${meterBar(cmdPct)}
        <div class="muted small" style="margin-top:8px">इस महीने: <b>${fmt(u.votesThisMonth)}</b> वोट · <b>${fmt(u.electionsThisMonth)}</b> चुनाव</div>
      </div>
      <div>
        <div class="muted small" style="margin-bottom:6px">
          <b>${bytesHuman(u.dbBytes)}</b> / ${bytesHuman(u.dbBytesQuota)} डेटा (${dbPct.toFixed(2)}%)
        </div>
        ${meterBar(dbPct)}
        <div class="muted small" style="margin-top:8px">खुली शिकायतें: <b>${fmt(u.openComplaints || 0)}</b> · लंबित खाता आवेदन: <b>${fmt(u.pendingApplications || 0)}</b> · बिना username खाते: <b>${fmt(u.accountsWithoutUsername || 0)}</b></div>
      </div>
    </div>
    <p class="muted small" style="margin-top:12px">
      सीमा: One+Upstash free = 5,00,000 commands/महीना · 250 MB डेटा. 60% से नीचे = बिल्कुल सुरक्षित.
      गिनती इस अपडेट के बाद से शुरू हुई है (पुराने दिन नहीं जुड़े).
    </p>
  </div>`;
}

/* =====================================================================
   📩 शिकायतें (grievance dashboard) — 24 घंटे में पुष्टि, 15 दिन में हल
   ===================================================================== */
let devComplaints = null;

async function loadDevComplaints() {
  try {
    devComplaints = await api('/api/dev/complaints');
  } catch (e) {
    devComplaints = { complaints: [], stats: { total: 0, open: 0, resolved: 0, oldestOpenAt: null }, error: e.message };
  }
  return devComplaints;
}

function complaintKindLabel(k) {
  return ({
    content: 'चुनाव/कंटेंट गलत',
    privacy: 'निजी जानकारी / नक़ल',
    technical: 'तकनीकी गड़बड़ी',
    other: 'कुछ और',
  })[k] || 'कुछ और';
}

function devComplaintsHTML() {
  if (!devComplaints) {
    return '<div class="dev-card"><p class="muted">शिकायतें लोड हो रही हैं…</p></div>';
  }
  if (devComplaints.error) {
    return `<div class="dev-card"><p class="muted">लोड नहीं हो पाया: ${esc(devComplaints.error)}</p></div>`;
  }
  const st = devComplaints.stats || {};
  const list = devComplaints.complaints || [];
  const oldest = st.oldestOpenAt
    ? Math.floor((Date.now() - st.oldestOpenAt) / (1000 * 60 * 60))
    : null;
  return `
  <div class="dev-stats" style="margin-bottom:16px">
    <div class="dev-stat"><b>${fmt(st.total || 0)}</b><span>कुल शिकायतें</span></div>
    <div class="dev-stat"><b>${fmt(st.open || 0)}</b><span>खुली</span></div>
    <div class="dev-stat"><b>${fmt(st.resolved || 0)}</b><span>हल हुई</span></div>
    <div class="dev-stat"><b>${oldest == null ? '—' : oldest + ' घं.'}</b><span>सबसे पुरानी खुली</span></div>
  </div>
  <div class="dev-card">
    <div class="dev-card-head">
      <h3>शिकायतें (नई सबसे ऊपर)</h3>
      <span class="storage-chip">24 घं. पुष्टि · 15 दिन हल</span>
    </div>
    ${list.length ? list.map((c) => `
      <div class="dev-top-item" style="align-items:flex-start;border-bottom:1px solid rgba(255,255,255,.08);padding:12px 0">
        <div class="dev-top-main" style="flex:1">
          <b>${esc(complaintKindLabel(c.kind))} · ticket ${esc(c.id)}</b>
          <span class="muted small">
            ${esc(timeAgo(c.at))} · ${c.status === 'open' ? '<b style="color:#f0a020">खुली</b>' : '<b style="color:#2fa84f">हल हुई</b>'}
            ${c.electionCode ? ' · चुनाव <a class="link" href="#/developer/e/' + esc(c.electionCode) + '">' + esc(c.electionCode) + '</a>' : ''}
          </span>
          <div style="margin-top:6px;white-space:pre-wrap">${esc(c.message)}</div>
          <div class="muted small" style="margin-top:6px">
            ${c.name ? 'नाम: <b>' + esc(c.name) + '</b> · ' : ''}${c.contact ? 'संपर्क: <b>' + esc(c.contact) + '</b>' : 'संपर्क नहीं दिया'}
            ${c.note ? ' · टिप्पणी: ' + esc(c.note) : ''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${c.status === 'open' ? `<button class="btn btn-ghost btn-sm" data-cid-resolve="${esc(c.id)}">हल हुई</button>` : ''}
          <button class="btn btn-ghost btn-sm" data-cid-delete="${esc(c.id)}" style="opacity:.75">हटाओ</button>
        </div>
      </div>`).join('') : '<p class="muted">अभी कोई शिकायत नहीं है. 🎉</p>'}
    <p class="muted small" style="margin-top:12px">
      रिकॉर्ड 180 दिन तक रखा जाता है (IT Rules 2021). किसी अदालत/सरकारी आदेश पर कंटेंट 36 घंटे में हटाया जाएगा.
    </p>
  </div>`;
}

/* =====================================================================
   🙋 खाता आवेदन (username भूल गए / साझा फ़ोन) — डेवलपर की मंज़ूरी
   ===================================================================== */
let devApplications = null;

async function loadDevApplications() {
  try {
    devApplications = await api('/api/dev/applications');
  } catch (e) {
    devApplications = { applications: [], stats: { total: 0, pending: 0, approved: 0, rejected: 0 }, error: e.message };
  }
  return devApplications;
}

function devApplicationKindLabel(k) {
  return k === 'device-second-account' ? 'साझा फ़ोन पर दूसरा खाता'
    : k === 'lost-pin-recovery' ? '🔑 PIN + कार्ड दोनों खो गए (खाता वापसी)'
    : 'Username भूल गए';
}
function devApplicationStatusLabel(s) {
  return s === 'approved' ? '<b style="color:#2fa84f">मंज़ूर</b>'
    : s === 'rejected' ? '<b style="color:#e5484d">अस्वीकृत</b>'
    : s === 'expired' ? '<b style="color:#9a93ad">समय समाप्त</b>'
    : '<b style="color:#f0a020">Pending — निर्णय चाहिए</b>';
}

function devApplicationsHTML() {
  if (!devApplications) return '<div class="dev-card"><p class="muted">खाता आवेदन लोड हो रहे हैं…</p></div>';
  if (devApplications.error) return `<div class="dev-card"><p class="muted">लोड नहीं हो पाया: ${esc(devApplications.error)}</p></div>`;
  const st = devApplications.stats || {};
  const list = devApplications.applications || [];
  return `
  <div class="dev-stats" style="margin-bottom:16px">
    <div class="dev-stat"><b>${fmt(st.pending || 0)}</b><span>Pending आवेदन</span></div>
    <div class="dev-stat"><b>${fmt(st.approved || 0)}</b><span>मंज़ूर</span></div>
    <div class="dev-stat"><b>${fmt(st.rejected || 0)}</b><span>अस्वीकृत</span></div>
    <div class="dev-stat"><b>${fmt(st.total || 0)}</b><span>कुल दिख रहे</span></div>
  </div>
  <div class="dev-card">
    <div class="dev-card-head">
      <h3>खाता आवेदन — Team Janmat की मंज़ूरी</h3>
      <span class="storage-chip">PIN/कोड यहाँ नहीं दिखता</span>
    </div>
    <p class="dev-note" style="margin-bottom:12px">
      <b>पुराना खाता बदलें</b> = आवेदक सच में वही व्यक्ति है; पुराने खाते के चुनाव/वोट नए username में आ जाएँगे और पुराना login बंद होगा।
      <b>अलग खाता बनाएँ</b> = साझा फ़ोन का दूसरा असली सदस्य। संदेह हो तो अस्वीकार करें और कारण लिखें।
    </p>
    ${list.length ? list.map((a) => `
      <div class="dev-application" style="border-bottom:1px solid rgba(255,255,255,.09);padding:14px 0">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <b>${esc(a.name)}</b>
          <span class="code-chip">@${esc(a.desiredUsername)}</span>
          <span class="mini-badge">${esc(devApplicationKindLabel(a.kind))}</span>
          <span>${devApplicationStatusLabel(a.status)}</span>
        </div>
        <div class="muted small" style="margin-top:5px">
          आवेदन <b>${esc(a.id)}</b> · ${esc(fullDate(a.createdAt))} (${esc(timeAgo(a.createdAt))})
          ${a.decidedAt ? ' · निर्णय: ' + esc(fullDate(a.decidedAt)) : ''}
        </div>
        <div style="margin-top:7px;white-space:pre-wrap"><b>कारण:</b> ${esc(a.reason)}</div>
        ${a.decisionNote ? '<div class="muted small" style="margin-top:5px">टिप्पणी: ' + esc(a.decisionNote) + '</div>' : ''}

        ${a.conflicts && a.conflicts.length ? `
          <div style="margin-top:9px">
            <b>इसी फ़ोन/पहचान से जुड़े पुराने खाते:</b>
            ${a.conflicts.map((u, i) => `
              <label style="display:block;margin-top:7px;cursor:${a.status === 'pending' && devAccountStatusInfo(u).status === 'active' ? 'pointer' : 'default'}">
                ${a.status === 'pending' && devAccountStatusInfo(u).status === 'active' ? '<input type="radio" name="appmode-' + esc(a.id) + '" value="replace:' + esc(u.id) + '"' + (a.conflicts.findIndex((x) => devAccountStatusInfo(x).status === 'active') === i ? ' checked' : '') + '> <b>पुराने खाते को बदलें:</b> ' : '• '}
                ${esc(u.name)} ${u.username ? '(@' + esc(u.username) + ')' : '(username नहीं)'}
                <span class="muted small">· ${u.electionsCreated} चुनाव बनाए · ${u.votesCast} वोट · आख़िरी लॉगिन ${esc(timeAgo(u.lastLoginAt))} · ${u.hasPassword ? 'पासवर्ड/PIN लगा' : 'बिना-पासवर्ड पुराना'}${devAccountStatusInfo(u).status === 'banned' ? ' · <b>रोक लगी है — replace नहीं होगा</b>' : devAccountStatusInfo(u).status === 'deleted' ? ' · <b>हटाया गया — replace नहीं होगा</b>' : devAccountStatusInfo(u).status !== 'active' ? ' · <b>चालू खाता नहीं</b>' : ''}</span>
              </label>`).join('')}
            ${a.status === 'pending' ? '<label style="display:block;margin-top:7px;cursor:pointer"><input type="radio" name="appmode-' + esc(a.id) + '" value="additional"' + (a.conflicts.some((x) => devAccountStatusInfo(x).status === 'active') ? '' : ' checked') + '> <b>अलग दूसरा खाता बनाएँ</b> <span class="muted small">(साझा फ़ोन का दूसरा सदस्य; पुराना खाता वैसा ही रहेगा)</span></label>' : ''}
          </div>` : '<div class="muted small" style="margin-top:8px">इस फ़ोन से जुड़ा कोई पुराना खाता सर्वर को नहीं मिला — कारण देखकर ही निर्णय लें।</div>'}

        ${a.status === 'pending' ? `
          <input id="app-note-${esc(a.id)}" type="text" maxlength="300" placeholder="उपयोगकर्ता को दिखने वाली छोटी टिप्पणी (वैकल्पिक)" style="margin-top:10px" />
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:9px">
            <button class="btn btn-primary btn-sm" data-app-approve="${esc(a.id)}">मंज़ूर करें</button>
            <button class="btn btn-danger btn-sm" data-app-reject="${esc(a.id)}">अस्वीकार करें</button>
          </div>` : `
          <div class="muted small" style="margin-top:8px">
            ${a.status === 'approved' ? 'उपयोगकर्ता अब अपने चुने username + PIN से लॉगिन कर सकता है।' : ''}
            ${a.replacedUserId ? ' पुराना खाता नए username से बदल दिया गया।' : ''}
          </div>`}
      </div>`).join('') : '<p class="muted">अभी कोई खाता आवेदन नहीं है।</p>'}
    <p class="muted small" style="margin-top:12px">आवेदन 7 दिन तक Pending रह सकता है। चुना username तब तक किसी और को नहीं मिलेगा।</p>
  </div>`;
}

function devStatsHTML() {
  if (!devData) return '';
  const s = devData.stats;
  return `
        <div class="dev-stat"><b>${fmt(s.users)}</b><span>यूज़र्स</span></div>
        <div class="dev-stat"><b>${fmt(s.elections)}</b><span>कुल चुनाव</span></div>
        <div class="dev-stat"><b>${fmt(s.votes)}</b><span>कुल वोट</span></div>
        <div class="dev-stat"><b>${fmt(s.todayElections)}</b><span>आज बने चुनाव</span></div>
        <div class="dev-stat"><b>${fmt(s.todayVotes)}</b><span>आज पड़े वोट</span></div>`;
}

let devRefreshTimer = null;
function scheduleDevRefresh() {
  clearTimeout(devRefreshTimer);
  devRefreshTimer = setTimeout(refreshDevData, 500);
}

async function refreshDevData() {
  if (!state.devToken) return;
  try {
    devData = await api('/api/dev/overview');
    if (devTab === 'applications') await loadDevApplications();
  } catch (_) { return; }
  const st = document.getElementById('devStats');
  if (st) st.innerHTML = devStatsHTML();
  const body = document.getElementById('devBody');
  if (body) { body.innerHTML = devBodyHTML(); bindDevBody(); }
  document.querySelectorAll('[data-devt]').forEach((tab) => {
    const k = tab.dataset.devt;
    if (k === 'active') tab.textContent = 'चालू चुनाव (' + devData.elections.filter((e) => !e.closed).length + ')';
    else if (k === 'elections') tab.textContent = 'सभी चुनाव (' + devData.elections.length + ')';
    else if (k === 'votes') tab.textContent = 'सभी वोट (' + devData.votes.length + ')';
    else if (k === 'users') tab.textContent = 'यूज़र्स (' + devData.users.length + ')';
    else if (k === 'complaints') tab.textContent = 'शिकायतें (' + (((devData.usage || {}).openComplaints) || 0) + ')';
    else if (k === 'applications') tab.textContent = 'खाता आवेदन (' + (((devData.usage || {}).pendingApplications) || 0) + ')';
    else if (k === 'summary') tab.textContent = 'सारांश';
  });
}

let devLiveSource = null;
let devLiveTotal = 0;

function stopDevLive() {
  if (devLiveSource) { try { devLiveSource.close(); } catch (_) {} devLiveSource = null; }
}

function startDevLive() {
  stopDevLive();
  if (window.JANMAT_OFFLINE) return;
  if (typeof EventSource === 'undefined' || !state.devToken) return;
  const statusEl = () => document.getElementById('devLiveStatus');
  try {
    devLiveSource = new EventSource(apiUrl('/api/dev/stream?token=' + encodeURIComponent(state.devToken)));
  } catch (_) { return; }

  devLiveSource.addEventListener('hello', () => {
    const st = statusEl(); if (st) st.textContent = 'जुड़ा हुआ — असली समय';
    const dot = document.getElementById('devLiveDot'); if (dot) dot.classList.add('on');
  });
  devLiveSource.addEventListener('vote', (ev) => {
    let d;
    try { d = JSON.parse(ev.data); } catch (_) { return; }
    devLiveTotal++;
    const cnt = document.getElementById('devLiveCount');
    if (cnt) cnt.textContent = String(devLiveTotal);
    const list = document.getElementById('devLiveList');
    if (!list) return;
    const emptyMsg = list.querySelector('p.muted');
    if (emptyMsg) emptyMsg.remove();
    const row = document.createElement('div');
    row.className = 'dev-live-row new';
    row.innerHTML = `
      <span class="dev-live-time">${new Date(d.at).toLocaleTimeString('hi-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span class="dev-live-who"><b>${esc(d.userName)}</b> ने</span>
      <span class="cand-cell">${symbolSVG(d.candidateSymbol, 15)} ${esc(d.candidateName)}</span>
      <a class="link small" href="#/e/${esc(d.electionCode)}">${esc(d.electionCode)}</a>
      <span class="muted small">कुल ${fmt(d.totalVotes)}</span>`;
    list.insertBefore(row, list.firstChild);
    while (list.children.length > 12) list.removeChild(list.lastChild);
    scheduleDevRefresh();
  });
  devLiveSource.addEventListener('new-election', (ev) => {
    let d; try { d = JSON.parse(ev.data); } catch (_) { return; }
    const list = document.getElementById('devLiveList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'dev-live-row new election-row';
    row.innerHTML = `<span class="dev-live-time">${new Date(d.at).toLocaleTimeString('hi-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="dev-live-who"><b>${esc(d.creatorName)}</b> ने नया चुनाव बनाया</span>
      <a class="link small" href="#/e/${esc(d.code)}">${esc(d.code)} — ${esc(d.title)}</a>`;
    list.insertBefore(row, list.firstChild);
    while (list.children.length > 12) list.removeChild(list.lastChild);
    scheduleDevRefresh();
  });
  ['election-status', 'user-deleted', 'user-moderated', 'account-application', 'account-application-decision'].forEach((evName) => {
    devLiveSource.addEventListener(evName, () => scheduleDevRefresh());
  });
  devLiveSource.onopen = () => {
    const st = statusEl(); if (st) st.textContent = 'जुड़ा हुआ — असली समय';
    const dot = document.getElementById('devLiveDot'); if (dot) dot.classList.add('on');
  };
  devLiveSource.onerror = () => {
    const st = statusEl(); if (st) st.textContent = 'फिर जुड़ रहे हैं…';
    const dot = document.getElementById('devLiveDot'); if (dot) dot.classList.remove('on');
  };
}


/* =====================================================================
   🟢 चालू चुनाव — हर चुनाव का अपना अलग कार्ड
   डेवलपर किसी भी कार्ड पर दबाकर सिर्फ़ उसी चुनाव का विवरण देखता है
   (किसने किसको वोट दिया) — सबका मिला-जुला नहीं।
   ===================================================================== */
function devActiveHTML() {
  const all = (devData.elections || []).filter((e) => !e.closed);
  /* सबसे सक्रिय (ज़्यादा वोट वाला) सबसे ऊपर, फिर नया */
  const active = [...all].sort((a, b) => (b.totalVotes - a.totalVotes) || (b.createdAt - a.createdAt));

  const head = `
    <div class="dev-card">
      <div class="dev-card-head">
        <h3>चालू चुनाव (${active.length})</h3>
        <div class="dev-tools">
          <input type="search" id="devActiveSearch" placeholder="गाँव / कोड / बनाने वाला…" />
        </div>
      </div>
      <p class="dev-note" style="margin:0 0 14px">
        किसी भी चुनाव के कार्ड पर दबाइए — सिर्फ़ उसी चुनाव का पूरा विवरण खुलेगा
        (किसने किसको वोट दिया, कब, कौन-सा डिवाइस)। सबका मिला-जुला नहीं।
      </p>`;

  if (!active.length) {
    return head + `
      <div class="empty" style="padding:34px 18px">
        <div class="em-ico">${ICON.ballot}</div>
        <h3>अभी कोई चुनाव नहीं चल रहा</h3>
        <p>जैसे ही कोई चुनाव बनेगा, वह यहाँ अपने अलग कार्ड में दिखेगा।</p>
      </div>
    </div>`;
  }

  return head + `
    <div class="dev-ecards" id="devActiveList">
      ${active.map((e) => {
        const left = e.remainingMs > 0 ? fmtLeft(e.remainingMs) : '';
        return `
      <button class="dev-ecard" data-e-open="${esc(e.code)}" data-name="${esc((e.title + ' ' + e.code + ' ' + e.gram + ' ' + e.creatorName).toLowerCase())}">
        <div class="dev-ecard-top">
          <span class="badge live"><i></i> चालू</span>
          ${left ? `<span class="dev-ecard-left">⏳ <b data-devleft="${e.remainingMs}">${esc(left)}</b></span>` : ''}
        </div>
        <h4>${esc(e.title)}</h4>
        <div class="dev-ecard-place">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)}</div>
        <div class="dev-ecard-nums">
          <div><b>${fmt(e.totalVotes)}</b><span>वोट</span></div>
          <div><b>${e.candidateCount}</b><span>उम्मीदवार</span></div>
          <div><b>${e.deviceCount}</b><span>डिवाइस</span></div>
        </div>
        <div class="dev-ecard-lead">
          ${e.leading && e.leading.votes
            ? `आगे: <b>${esc(e.leading.name)}</b> · ${fmt(e.leading.votes)} वोट (${e.leading.percent}%)`
            : '<span class="muted">अभी कोई वोट नहीं पड़ा</span>'}
        </div>
        <div class="dev-ecard-foot">
          <span class="code-chip">${esc(e.code)}</span>
          <span class="creator-tag">${esc(e.creatorName)}</span>
          <span class="dev-ecard-cta">पूरा विवरण देखें →</span>
        </div>
      </button>`;
      }).join('')}
    </div>
  </div>`;
}

/* ---------- एक चुनाव का पूरा पेज (सिर्फ़ उसी का डेटा) ---------- */
let devDetailTimer = null;

async function renderDevElection(code) {
  setActiveNav('');
  clearPoll();
  if (devDetailTimer) { clearInterval(devDetailTimer); devDetailTimer = null; }
  if (!state.devToken) return renderDevLogin();

  app.innerHTML = `<section class="section"><div class="wrap">
    <div class="skeleton" style="height:22px;width:40%"></div>
    <div class="skeleton" style="height:120px;border-radius:18px;margin-top:18px"></div>
    <div class="skeleton" style="height:220px;border-radius:18px;margin-top:14px"></div>
  </div></section>`;

  let d;
  try {
    d = await api('/api/dev/elections/' + encodeURIComponent(code));
  } catch (e) {
    app.innerHTML = `<section class="section"><div class="wrap"><div class="empty">
      <div class="em-ico">${ICON.warn}</div><h3>नहीं खुल पाया</h3>
      <p>${esc(e.message)}</p>
      <a class="btn btn-primary" href="#/developer">डेवलपर पैनल पर लौटें</a></div></div></section>`;
    return;
  }
  paintDevElection(d);

  /* हर 5 सेकंड में सिर्फ़ इसी चुनाव का ताज़ा डेटा */
  if (devDetailTimer) { clearInterval(devDetailTimer); devDetailTimer = null; }
  devDetailTimer = setInterval(async () => {
    /* 🐞 FIX: अगर यूज़र इस पेज से जा चुका है तो टाइमर बंद कर दो —
       पुराना पेज कभी वापस नहीं चिपकेगा। */
    const stillHere = String(location.hash || '').startsWith('#/developer/e/' + code);
    if (!stillHere) {
      clearInterval(devDetailTimer);
      devDetailTimer = null;
      return;
    }
    try {
      const fresh = await api('/api/dev/elections/' + encodeURIComponent(code));
      /* जवाब आने तक भी पेज बदल सकता है — फिर जाँचो */
      if (!String(location.hash || '').startsWith('#/developer/e/' + code)) {
        clearInterval(devDetailTimer);
        devDetailTimer = null;
        return;
      }
      paintDevElection(fresh);
    } catch (_) {}
  }, 5000);
}

function paintDevElection(d) {
  const e = d.election;
  const rows = d.votes || [];
  const total = e.results ? e.results.totalVotes : 0;
  const left = e.remainingMs > 0 ? fmtLeft(e.remainingMs) : '';

  const votesTable = rows.length ? `
    <div class="dev-vote-list" id="devOneTable">
      ${rows.map((v) => `
        <div class="dev-vote-item">
          <div class="dvv-top">
            <b>${esc(v.userName)}</b>${devVoteIdentityHTML(v)}
          </div>
          <div class="dvv-mid">
            <span><b>${esc(v.userName)}</b> ने ${symbolSVG(v.candidateSymbol, 17)} <b>${esc(v.candidateName)}</b> को वोट दिया</span>
          </div>
          <div class="dvv-dev muted small">${esc(fullDate(v.at))} · डिवाइस: ${esc(v.deviceShort || '—')}</div>
        </div>`).join('')}
    </div>` : `<div class="empty" style="padding:26px 14px">
        <h3 style="font-size:16px">इस चुनाव में अभी कोई वोट नहीं</h3>
        <p class="muted small">जैसे ही कोई वोट डालेगा, यहाँ नाम और उम्मीदवार दिख जाएगा।</p>
      </div>`;

  app.innerHTML = `
  <section class="dev-page">
    <div class="wrap">
      <a class="link back-link" href="#/developer">← डेवलपर पैनल</a>

      <div class="dev-one-head">
        <div>
          <div class="dev-one-badges">
            ${e.closed ? '<span class="badge closed">समाप्त</span>' : '<span class="badge live"><i></i> चालू</span>'}
            <span class="code-chip">${esc(e.code)}</span>
            <span class="mini-badge">${esc(e.type || 'चुनाव')}</span>
          </div>
          <h1>${esc(e.title)}</h1>
          <p class="muted">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)}</p>
          <p class="muted small">बनाने वाला: <b class="creator-tag">${esc(e.creatorName)}</b>
            ${left ? ` · ⏳ <b data-devleft="${e.remainingMs}">${esc(left)}</b>` : ''}
            ${e.closed ? ` · समाप्त ${esc(shortDate(e.closedAt || e.endsAt || Date.now()))}` : ''}</p>
        </div>
        <div class="dev-one-actions">
          <button class="btn btn-ghost btn-sm" id="devOneRefresh">ताज़ा करें</button>
          <button class="btn btn-ghost btn-sm" id="devOneCsv">${ICON.download} इसका CSV</button>
          <a class="btn btn-ghost btn-sm" href="#/e/${esc(e.code)}" target="_blank" rel="noopener">सार्वजनिक पेज</a>
          <button class="btn btn-ghost btn-sm" id="devOneToggle">${e.closed ? 'चुनाव फिर खोलें' : 'चुनाव बंद करें'}</button>
          <button class="btn btn-danger btn-sm" id="devOneDelete">${ICON.trash || ''} चुनाव हटाएँ</button>
        </div>
      </div>

      <div class="dev-stats dev-one-stats">
        <div class="dev-stat"><b>${fmt(total)}</b><span>कुल वोट</span></div>
        <div class="dev-stat"><b>${e.candidateCount || (e.candidates || []).length}</b><span>उम्मीदवार</span></div>
        <div class="dev-stat"><b>${rows.length}</b><span>वोट रिकॉर्ड</span></div>
        <div class="dev-stat"><b>${new Set(rows.map((v) => v.deviceShort)).size}</b><span>डिवाइस</span></div>
      </div>

      <div class="dev-card">
        <div class="dev-card-head"><h3>इस चुनाव का नतीजा</h3>
          <span class="mini-badge">सिर्फ़ ${esc(e.code)}</span></div>
        <div class="dev-mini-results">
          ${(e.results ? e.results.candidates : []).map((c) => `
            <div class="dev-mini-row">
              <span class="cand-cell">${symbolSVG(c.symbol, 16)} ${esc(c.name)}</span>
              <span class="muted small">${fmt(c.votes)} वोट · ${c.percent}%</span>
            </div>`).join('') || '<p class="muted small">उम्मीदवार नहीं</p>'}
        </div>
      </div>

      ${(d.samePhoneVotes && d.samePhoneVotes.length) ? `
      <div class="dev-warn">
        ⚠️ <b>शक की जगह:</b> ${d.samePhoneVotes.length} फ़ोन से एक से ज़्यादा वोट दर्ज हुए हैं
        (एक ही ब्राउज़र/इनकॉग्निटो से दोबारा वोट). हर फ़ोन पर: ${d.samePhoneVotes.map((x) => x.count).join(', ')} वोट।
        बिना OTP इसे पूरी तरह रोका नहीं जा सकता — पर यहाँ पकड़ में आ जाता है।
      </div>` : ''}

      <div class="dev-card">
        <div class="dev-card-head">
          <h3>किसने किसको वोट दिया (${rows.length})</h3>
          <div class="dev-tools"><input type="search" id="devOneSearch" placeholder="मतदाता / उम्मीदवार…" /></div>
        </div>
        ${votesTable}
        <p class="dev-note">यह सिर्फ़ इस चुनाव (<b>${esc(e.code)}</b>) का डेटा है — दूसरे चुनावों के वोट यहाँ नहीं मिलाए गए। सिर्फ़ डेवलपर को दिखता है।</p>
      </div>
    </div>
  </section>`;

  /* ताज़ा करें */
  const rf = document.getElementById('devOneRefresh');
  if (rf) rf.addEventListener('click', async () => {
    rf.disabled = true;
    try { paintDevElection(await api('/api/dev/elections/' + encodeURIComponent(e.code))); }
    catch (err) { toast(err.message, 'err'); rf.disabled = false; }
  });

  /* इसी चुनाव का CSV */
  const csvBtn = document.getElementById('devOneCsv');
  if (csvBtn) csvBtn.addEventListener('click', () => {
    const head = ['समय', 'मतदाता', 'उम्मीदवार', 'डिवाइस'];
    const lines = [head.join(',')];
    rows.forEach((v) => lines.push([fullDate(v.at), v.userName, v.candidateName, v.deviceShort || '']
      .map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')));
    downloadFile('janmat-' + e.code + '-votes.csv', '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
  });

  /* बंद / खोलें (डेवलपर — टाइमर की बंदिश उस पर लागू नहीं) */
  const tg = document.getElementById('devOneToggle');
  if (tg) tg.addEventListener('click', async () => {
    tg.disabled = true;
    try {
      await api('/api/elections/' + encodeURIComponent(e.code) + '/' + (e.closed ? 'reopen' : 'close'), { method: 'POST' });
      exploreCache = null;
      toast(e.closed ? 'चुनाव फिर खोल दिया' : 'चुनाव बंद कर दिया', 'ok');
      paintDevElection(await api('/api/dev/elections/' + encodeURIComponent(e.code)));
    } catch (err) { toast(err.message, 'err'); tg.disabled = false; }
  });

  /* 🔴 किसी भी चुनाव को साइट से हटाएँ — चलता हो या पूरा, दोनों */
  const del = document.getElementById('devOneDelete');
  if (del) {
    let armed = false, t = null;
    del.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        del.textContent = 'पक्का? दोबारा दबाएँ — हमेशा के लिए हटेगा';
        clearTimeout(t);
        t = setTimeout(() => { armed = false; del.textContent = 'चुनाव हटाएँ'; }, 6000);
        return;
      }
      clearTimeout(t);
      del.disabled = true;
      del.textContent = 'हट रहा है…';
      try {
        await api('/api/dev/elections/' + encodeURIComponent(e.code) + '/delete', { method: 'POST' });
        exploreCache = null;
        toast('चुनाव साइट से हटा दिया (कोड ' + e.code + ')', 'ok');
        location.hash = '#/developer';
      } catch (err) {
        toast(err.message, 'err');
        del.disabled = false;
        del.textContent = 'चुनाव हटाएँ';
        armed = false;
      }
    });
  }

  /* खोज */
  const srch = document.getElementById('devOneSearch');
  if (srch) srch.addEventListener('input', () => {
    const q = srch.value.trim().toLowerCase();
    $$('#devOneTable .dev-vote-item').forEach((row) => {
      row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  startDevLeftTicker();
}

/* बचा समय — हर सेकंड */
function startDevLeftTicker() {
  const els = $$('[data-devleft]');
  if (!els.length) return;
  const base = els.map((el) => Number(el.dataset.devleft) || 0);
  const t0 = Date.now();
  const tick = () => {
    els.forEach((el, i) => {
      const ms = base[i] - (Date.now() - t0);
      el.textContent = ms > 0 ? fmtLeft(ms) : 'समय पूरा';
    });
  };
  tick();
  const iv = setInterval(tick, 1000);
  setTimeout(() => clearInterval(iv), 1000 * 60 * 60 * 3);
}

function devBodyHTML() {
  if (!devData) return '';
  if (devTab === 'active') return devActiveHTML();
  if (devTab === 'summary') return devSummaryHTML();
  if (devTab === 'users') return devUsersHTML();
  if (devTab === 'elections') return devElectionsHTML();
  if (devTab === 'complaints') return devComplaintsHTML();
  if (devTab === 'applications') return devApplicationsHTML();
  return devVotesHTML();
}

/* =====================================================================
   Go-Live checklist — "kya sach me live hai?" ka seedha jawab
   (data safe hai? server juda hai? log chunav dekh payenge?)
   ===================================================================== */
function goLiveHTML() {
  const s = (devData && devData.stats) || {};
  const serverOk = !window.JANMAT_OFFLINE;
  const redis = s.storage === 'redis';
  const fileStore = s.storage !== 'redis' && s.storage !== 'preview' && serverOk;
  const hasElections = (s.elections || 0) > 0;
  const shareUrl = pageBase();

  const row = (kind, title, desc) => `
    <div class="golive-row">
      <span class="golive-ico ${kind}">${kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '×'}</span>
      <div class="golive-main"><b>${title}</b><span>${desc}</span></div>
    </div>`;

  return `
  <div class="dev-card golive-card">
    <div class="dev-card-head"><h3>सिस्टम जाँच — असली साझा मतदान के लिए</h3>
      <span class="mini-badge">${serverOk ? 'सर्वर से जुड़ा' : 'प्रीव्यू'}</span></div>

    ${row(serverOk ? 'ok' : 'bad',
      serverOk ? 'सर्वर जुड़ा हुआ है' : 'सर्वर से नहीं जुड़ा',
      serverOk
        ? 'चुनाव और वोट सर्वर पर सेव हो रहे हैं — दूसरे लोग भी यही चुनाव देख/वोट कर सकते हैं।'
        : 'अभी सब कुछ सिर्फ़ इसी ब्राउज़र में है। असली मतदान के लिए साइट को सर्वर (Render) से जोड़ें — निर्देश README / SHARED-VOTING.md में।')}

    ${row(redis ? 'ok' : 'warn',
      redis ? 'डेटा हमेशा के लिए सुरक्षित (Upstash Redis)' : 'डेटा फ़ाइल में है — रीस्टार्ट पर मिट सकता है',
      redis
        ? 'हर चुनाव और वोट स्थायी डेटाबेस में है; होस्टिंग रीस्टार्ट होने पर भी कुछ नहीं जाएगा।'
        : 'Render के मुफ़्त प्लान पर डिस्क स्थायी नहीं होती — नया deploy/रीस्टार्ट होने पर चुनाव गायब हो सकते हैं। मुफ़्त Upstash Redis जोड़ें: <code>UPSTASH_REDIS_REST_URL</code> + <code>UPSTASH_REDIS_REST_TOKEN</code> (README में 4 कदम)।')}

    ${row('ok',
      'खोजकर आने वाले भी चुनाव देख सकते हैं',
      'सार्वजनिक पेज: <code>' + esc(shareUrl) + '#/explore</code> — यहाँ हर चुनाव, कोड और ज़िले से खोजा जा सकता है; लॉगिन की ज़रूरत नहीं।')}

    ${row(hasElections ? 'ok' : 'warn',
      hasElections ? ('इस समय ' + fmt(s.elections) + ' असली चुनाव लाइव हैं') : 'अभी कोई चुनाव नहीं बना',
      hasElections
        ? 'कुल ' + fmt(s.votes) + ' वोट · ' + fmt(s.users) + ' मतदाता · किसी भी दिन ' + (s.dailyLimit || 2) + ' चुनाव प्रति यूज़र'
        : 'जब तक कोई असली चुनाव नहीं बनाता, खोजने वालों को साफ़ संदेश दिखता है (कोई नक़ली/डेमो चुनाव नहीं)। पहला चुनाव बनाकर शुरुआत करें।')}

    ${row('ok',
      'कोई डेमो/नक़ली डेटा नहीं',
      'डेटाबेस में सिर्फ़ असली लोगों के असली चुनाव हैं — साइट पर कहीं भी बनावटी परिणाम नहीं दिखाए जाते।')}
  </div>`;
}

function devSummaryHTML() {
  const s = devData.stats;
  const recentVotes = devData.votes.slice(0, 8);
  const topElections = [...devData.elections].sort((a, b) => b.totalVotes - a.totalVotes).slice(0, 5);
  return `
  ${goLiveHTML()}
  ${usageMeterHTML()}
  <div class="dev-grid2">
    <div class="dev-card">
      <div class="dev-card-head"><h3>हाल के वोट</h3><button class="btn btn-ghost btn-sm" data-devt-jump="votes">सब देखें</button></div>
      <table class="dev-table">
        <thead><tr><th>समय</th><th>मतदाता</th><th>उम्मीदवार</th><th>चुनाव</th></tr></thead>
        <tbody>
          ${recentVotes.map((v) => `
            <tr>
              <td class="nowrap">${esc(timeAgo(v.at))}</td>
              <td><b>${esc(v.userName)}</b>${v.userIsDemo ? ' <span class="mini-badge">डेमो</span>' : ''}${devVoteIdentityHTML(v)}</td>
              <td><span class="cand-cell">${symbolSVG(v.candidateSymbol, 16)} ${esc(v.candidateName)}</span></td>
              <td class="nowrap"><a href="#/e/${v.electionCode}" class="link">${esc(v.electionCode)}</a></td>
            </tr>`).join('') || '<tr><td colspan="4" class="muted">कोई वोट नहीं</td></tr>'}
        </tbody>
      </table>
    </div>

    <div class="dev-card">
      <div class="dev-card-head"><h3>सबसे सक्रिय चुनाव</h3><button class="btn btn-ghost btn-sm" data-devt-jump="elections">सब देखें</button></div>
      <div class="dev-toplist">
        ${topElections.map((e) => `
          <div class="dev-top-item">
            <div class="dev-top-main">
              <b>${esc(e.title)}</b>
              <span class="muted small">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)}</span>
              <span class="muted small">बनाने वाला: <b class="creator-tag">${esc(e.creatorName)}</b></span>
            </div>
            <div class="dev-top-votes"><b>${fmt(e.totalVotes)}</b><span>वोट</span></div>
          </div>`).join('') || '<p class="muted">कोई चुनाव नहीं</p>'}
      </div>
      <div class="dev-actions">
        <button class="btn btn-ghost btn-sm" id="exportAll">${ICON.download} पूरा डेटा CSV</button>
        <button class="btn btn-ghost btn-sm" id="refreshDev">↻ ताज़ा करें</button>
      </div>
      <p class="dev-note">सर्वर समय: ${esc(fullDate(s.serverTime))} · रोज़ सीमा: ${s.dailyLimit} चुनाव/यूज़र</p>
    </div>
  </div>`;
}

function devAccountStatusInfo(u) {
  const banUntil = Number((u && u.banUntil) || 0) || null;
  let status = u && u.deletedAt ? 'deleted' : ((u && u.accountStatus) || 'active');
  if (status === 'banned' && u && u.banType === 'temporary' && banUntil && Date.now() >= banUntil) status = 'active';
  return { status, banUntil };
}

function devAccountStatusHTML(u) {
  const info = devAccountStatusInfo(u);
  if (info.status === 'active') return '<span class="badge live">चालू खाता</span>';
  if (info.status === 'banned') {
    const until = u.banType === 'temporary' && info.banUntil
      ? '<div class="muted small">' + esc(fullDate(info.banUntil)) + ' तक</div>'
      : '<div class="muted small">स्थायी रोक</div>';
    const reason = u.banReason ? '<div class="muted small" style="max-width:220px;white-space:normal">कारण: ' + esc(u.banReason) + '</div>' : '';
    return '<span class="badge closed">रोक लगी है</span>' + until + reason;
  }
  if (info.status === 'deleted') {
    const when = u.deletedAt ? '<div class="muted small">' + esc(fullDate(u.deletedAt)) + '</div>' : '';
    const by = u.deletedBy === 'developer' ? '<div class="muted small">डेवलपर द्वारा हटाया</div>' : (u.deletedBy === 'self' ? '<div class="muted small">उपयोगकर्ता ने खुद हटाया</div>' : '');
    return '<span class="badge closed">हटाया गया</span>' + when + by;
  }
  if (info.status === 'replaced') return '<span class="badge closed">पुराना बदला खाता</span><div class="muted small">login बंद</div>';
  return '<span class="badge closed">' + esc(info.status) + '</span>';
}

function devUsersHTML() {
  return `
  <div class="dev-card">
    <div class="dev-card-head">
      <h3>सभी यूज़र्स (${devData.users.length})</h3>
      <div class="dev-tools">
        <input type="search" id="devUserSearch" placeholder="नाम खोजें…" />
        <button class="btn btn-ghost btn-sm" id="exportUsers">${ICON.download} CSV</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="dev-table" id="devUsersTable">
        <thead><tr><th>नाम / Username</th><th>जुड़े</th><th>बनाए चुनाव</th><th>दिए वोट</th><th>डिवाइस</th><th>आख़िरी लॉगिन</th><th>स्थिति / खाता नियंत्रण</th></tr></thead>
        <tbody>
          ${devData.users.map((u) => `
            <tr data-name="${esc((u.name + ' ' + (u.username || '')).toLowerCase())}">
              <td><b>${esc(u.name)}</b>${u.isDemo ? ' <span class="mini-badge">डेमो</span>' : ''}<div class="muted small">${u.username ? '@' + esc(u.username) : 'username नहीं'}</div></td>
              <td class="nowrap">${esc(timeAgo(u.createdAt))}</td>
              <td>${u.electionsCreated ? `<button class="chip-btn" data-user-elections="${esc(u.id)}">${u.electionsCreated}</button>` : '0'}</td>
              <td>${u.votesCast}</td>
              <td>${u.deviceCount}</td>
              <td class="nowrap">${esc(timeAgo(u.lastLoginAt))}</td>
              <td class="nowrap">
                ${devAccountStatusHTML(u)}
                ${['active', 'banned'].includes(devAccountStatusInfo(u).status) ? `<div style="margin-top:7px"><button class="btn btn-ghost btn-sm" data-user-moderate="${esc(u.id)}">खाता नियंत्रण</button></div>` : ''}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function devElectionsHTML() {
  return `
  <div class="dev-card">
    <div class="dev-card-head">
      <h3>सभी चुनाव (${devData.elections.length})</h3>
      <div class="dev-tools">
        <input type="search" id="devElectionSearch" placeholder="शीर्षक / कोड / बनाने वाला…" />
        <button class="btn btn-ghost btn-sm" id="exportElections">${ICON.download} CSV</button>
      </div>
    </div>
    <div class="table-wrap">
      <table class="dev-table" id="devElectionsTable">
        <thead><tr><th>कोड</th><th>चुनाव</th><th>बनाने वाला</th><th>वोट</th><th>आगे</th><th>स्थिति</th><th></th></tr></thead>
        <tbody>
          ${devData.elections.map((e) => `
            <tr data-name="${esc((e.title + ' ' + e.code + ' ' + e.creatorName).toLowerCase())}">
              <td class="nowrap"><span class="code-chip">${esc(e.code)}</span></td>
              <td>
                <b>${esc(e.title)}</b>
                <div class="muted small">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)}</div>
              </td>
              <td><span class="creator-tag">${esc(e.creatorName)}</span>${e.creatorIsDemo ? ' <span class="mini-badge">डेमो</span>' : ''}</td>
              <td><b>${fmt(e.totalVotes)}</b><div class="muted small">${e.deviceCount} डिवाइस</div></td>
              <td>${e.leading && e.leading.votes ? `${esc(e.leading.name)} <span class="muted small">(${e.leading.percent}%)</span>` : '<span class="muted">—</span>'}</td>
              <td>${e.closed ? '<span class="badge closed">समाप्त</span>' : '<span class="badge live">चालू</span>'}</td>
              <td class="nowrap">
                <button class="btn btn-ghost btn-sm" data-e-detail="${e.code}">विवरण</button>
                <button class="btn ${e.closed ? 'btn-ghost' : 'btn-danger'} btn-sm" data-dev-close="${e.code}" data-action="${e.closed ? 'reopen' : 'close'}">${e.closed ? 'खोलें' : 'बंद'}</button>
                <button class="btn btn-ghost btn-sm" data-dev-del="${e.code}" title="साइट से पूरी तरह हटाएँ">हटाएँ</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function devVotesHTML() {
  return `
  <div class="dev-card">
    <div class="dev-card-head">
      <h3>किसने किसको वोट दिया (${devData.votes.length})</h3>
      <div class="dev-tools">
        <input type="search" id="devVoteSearch" placeholder="मतदाता / उम्मीदवार / कोड…" />
        <button class="btn btn-ghost btn-sm" id="exportVotes">${ICON.download} CSV</button>
      </div>
    </div>
    <div class="table-wrap tall">
      <table class="dev-table" id="devVotesTable">
        <thead><tr><th>समय</th><th>मतदाता का नाम</th><th>चुनाव</th><th>उम्मीदवार</th><th>पार्टी</th><th>डिवाइस</th></tr></thead>
        <tbody>
          ${devData.votes.map((v) => `
            <tr data-name="${esc((v.userName + ' ' + (v.userUsername || '') + ' ' + (v.linkedUsername || '') + ' ' + v.candidateName + ' ' + v.electionCode + ' ' + v.electionTitle).toLowerCase())}">
              <td class="nowrap">${esc(fullDate(v.at))}</td>
              <td><b>${esc(v.userName)}</b>${v.userIsDemo ? ' <span class="mini-badge">डेमो</span>' : ''}${devVoteIdentityHTML(v)}</td>
              <td class="nowrap"><a class="link" href="#/e/${v.electionCode}">${esc(v.electionCode)}</a><div class="muted small">${esc(v.electionTitle)}</div></td>
              <td><span class="cand-cell">${symbolSVG(v.candidateSymbol, 16)} ${esc(v.candidateName)}</span></td>
              <td>${esc(v.candidateParty || '—')}</td>
              <td class="muted small nowrap">${esc(v.deviceShort)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p class="dev-note">यह सूची सिर्फ़ डेवलपर को दिखती है। सार्वजनिक पेजों पर किसी मतदाता का नाम नहीं दिखता।</p>
  </div>`;
}

function devVoteIdentityHTML(v) {
  const uname = v.linkedUsername || v.userUsername;
  let out = '';
  if (uname) out += ' <span class="muted small">@' + esc(uname) + '</span>';
  if (v.voteSource === 'guest-first' || v.adopted || v.linkedName) {
    out += ' <span class="mini-badge">पहले मेहमान वोट' + (uname ? ' → बाद में @' + esc(uname) : ' → बाद में नाम जुड़ा') + '</span>';
  } else if (v.voteSource === 'guest') {
    out += ' <span class="mini-badge">मेहमान वोट (खाता नहीं)</span>';
  }
  return out;
}

function bindDevBody() {
  /* 🙋 खाता आवेदन मंज़ूर/अस्वीकार (Team Janmat निर्णय) */
  const finishApplication = async (id, action, button) => {
    const noteEl = document.getElementById('app-note-' + id);
    const note = noteEl ? noteEl.value.trim() : '';
    let body = { note };
    if (action === 'approve') {
      const picked = document.querySelector('input[name="appmode-' + id + '"]:checked');
      if (picked && picked.value.indexOf('replace:') === 0) body.replaceUserId = picked.value.slice('replace:'.length);
      else if (picked && picked.value === 'additional') body.mode = 'additional';
    }
    if (action === 'reject' && !window.confirm('आवेदन ' + id + ' अस्वीकार कर दें?')) return;
    button.disabled = true;
    button.textContent = '…';
    try {
      await api('/api/dev/applications/' + encodeURIComponent(id) + '/' + action, { method: 'POST', body });
      await loadDevApplications();
      await refreshDevData();
      toast(action === 'approve' ? 'आवेदन मंज़ूर — खाता तैयार है ✅' : 'आवेदन अस्वीकार कर दिया', 'ok');
    } catch (e) {
      toast(e.message || 'निर्णय सेव नहीं हुआ', 'err');
      button.disabled = false;
      button.textContent = action === 'approve' ? 'मंज़ूर करें' : 'अस्वीकार करें';
    }
  };
  $$('[data-app-approve]').forEach((b) => b.addEventListener('click', () => finishApplication(b.dataset.appApprove, 'approve', b)));
  $$('[data-app-reject]').forEach((b) => b.addEventListener('click', () => finishApplication(b.dataset.appReject, 'reject', b)));

  /* 📩 शिकायत "हल हुई" बटन */
  $$('[data-cid-resolve]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.cidResolve;
      b.disabled = true; b.textContent = '…';
      try {
        await api('/api/dev/complaints/' + encodeURIComponent(id) + '/resolve', { method: 'POST', body: { note: '' } });
        await loadDevComplaints();
        const body = document.getElementById('devBody');
        if (body) { body.innerHTML = devBodyHTML(); bindDevBody(); }
        toast('शिकायत हल के रूप में दर्ज ✅', 'ok');
      } catch (e) {
        b.disabled = false; b.textContent = 'हल हुई';
        toast(e.message || 'अपडेट नहीं हुआ', 'err');
      }
    });
  });

  /* 📩 शिकायत "हटाओ" बटन (स्पैम/टेस्ट साफ़ करने के लिए) */
  $$('[data-cid-delete]').forEach((b) => {
    b.addEventListener('click', async () => {
      const id = b.dataset.cidDelete;
      if (!window.confirm('शिकायत ' + id + ' हमेशा के लिए हटा दें?')) return;
      b.disabled = true; b.textContent = '…';
      try {
        await api('/api/dev/complaints/' + encodeURIComponent(id) + '/delete', { method: 'POST' });
        await loadDevComplaints();
        const body = document.getElementById('devBody');
        if (body) { body.innerHTML = devBodyHTML(); bindDevBody(); }
        toast('शिकायत हट गई', 'ok');
      } catch (e) {
        b.disabled = false; b.textContent = 'हटाओ';
        toast(e.message || 'नहीं हटी', 'err');
      }
    });
  });

  /* चालू चुनाव के कार्ड → सिर्फ़ उसी चुनाव का पेज */
  $$('[data-e-open]').forEach((card) => {
    card.addEventListener('click', () => { location.hash = '#/developer/e/' + card.dataset.eOpen; });
  });
  const actSearch = document.getElementById('devActiveSearch');
  if (actSearch) actSearch.addEventListener('input', () => {
    const q = actSearch.value.trim().toLowerCase();
    $$('#devActiveList .dev-ecard').forEach((c) => {
      c.style.display = !q || (c.dataset.name || '').includes(q) ? '' : 'none';
    });
  });
  startDevLeftTicker();

  const jump = async (tab) => {
    devTab = tab;
    $$('[data-devt]').forEach((b) => b.classList.toggle('active', b.dataset.devt === tab));
    if (tab === 'complaints') await loadDevComplaints();
    if (tab === 'applications') await loadDevApplications();
    document.getElementById('devBody').innerHTML = devBodyHTML();
    bindDevBody();
  };
  $$('[data-devt-jump]').forEach((b) => b.addEventListener('click', () => jump(b.dataset.devtJump)));

  const search = (inputId, tableId) => {
    const input = document.getElementById(inputId);
    const table = document.getElementById(tableId);
    if (!input || !table) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      $$('tbody tr', table).forEach((tr) => {
        tr.style.display = !q || (tr.dataset.name || '').includes(q) ? '' : 'none';
      });
    });
  };
  search('devUserSearch', 'devUsersTable');
  search('devElectionSearch', 'devElectionsTable');
  search('devVoteSearch', 'devVotesTable');

  const exportUsers = document.getElementById('exportUsers');
  if (exportUsers) {
    exportUsers.addEventListener('click', () => {
      const rows = [['नाम', 'Username', 'स्थिति', 'रोक कब तक', 'रोक/हटाने का कारण', 'जुड़े', 'बनाए चुनाव', 'दिए वोट', 'डिवाइस', 'डेमो']];
      devData.users.forEach((u) => {
        const info = devAccountStatusInfo(u);
        rows.push([
          u.name, u.username || '', info.status,
          info.status === 'banned' ? (u.banType === 'temporary' && info.banUntil ? fullDate(info.banUntil) : 'स्थायी') : '',
          u.banReason || u.deleteReason || '',
          fullDate(u.createdAt), u.electionsCreated, u.votesCast, u.deviceCount, u.isDemo ? 'हाँ' : 'नहीं',
        ]);
      });
      downloadFile('janmat-users.csv', '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
    });
  }
  const exportElections = document.getElementById('exportElections');
  if (exportElections) {
    exportElections.addEventListener('click', () => {
      const rows = [['कोड', 'शीर्षक', 'गाँव', 'ज़िला', 'राज्य', 'बनाने वाला', 'कुल वोट', 'स्थिति', 'बना']];
      devData.elections.forEach((e) => rows.push([e.code, e.title, e.gram, e.district, e.state, e.creatorName, e.totalVotes, e.closed ? 'समाप्त' : 'चालू', fullDate(e.createdAt)]));
      downloadFile('janmat-elections.csv', '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
    });
  }
  const exportVotes = document.getElementById('exportVotes');
  if (exportVotes) {
    exportVotes.addEventListener('click', () => {
      const rows = [['समय', 'मतदाता', 'Username', 'वोट-स्रोत', 'चुनाव कोड', 'चुनाव शीर्षक', 'उम्मीदवार', 'पार्टी', 'डिवाइस']];
      devData.votes.forEach((v) => rows.push([fullDate(v.at), v.userName, v.linkedUsername || v.userUsername || '', v.voteSource || '', v.electionCode, v.electionTitle, v.candidateName, v.candidateParty, v.deviceShort]));
      downloadFile('janmat-votes.csv', '\ufeff' + rows.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
    });
  }
  const exportAll = document.getElementById('exportAll');
  if (exportAll) {
    exportAll.addEventListener('click', () => {
      downloadFile('janmat-full-backup.json', JSON.stringify(devData, null, 2), 'application/json');
    });
  }

  const refreshDev = document.getElementById('refreshDev');
  if (refreshDev) {
    refreshDev.addEventListener('click', async () => {
      refreshDev.disabled = true;
      await refreshDevData();
      refreshDev.disabled = false;
      toast('ताज़ा डेटा आ गया', 'ok');
    });
  }

  $$('[data-user-elections]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const u = devData.users.find((x) => x.id === btn.dataset.userElections);
      if (!u) return;
      const list = devData.elections.filter((e) => e.creatorId === u.id);
      openDevModal(`<h3>${esc(u.name)} के चुनाव</h3>` + (list.length ? `
        <table class="dev-table"><thead><tr><th>कोड</th><th>चुनाव</th><th>वोट</th><th>स्थिति</th></tr></thead><tbody>
        ${list.map((e) => `<tr><td><span class="code-chip">${e.code}</span></td><td>${esc(e.title)}</td><td>${fmt(e.totalVotes)}</td><td>${e.closed ? 'समाप्त' : 'चालू'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">कोई चुनाव नहीं</p>'));
    });
  });

  $$('[data-user-moderate]').forEach((btn) => {
    btn.addEventListener('click', () => openDevUserModeration(btn.dataset.userModerate));
  });

  $$('[data-e-detail]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.hash = '#/developer/e/' + btn.dataset.eDetail;
    });
  });

  $$('[data-dev-del]').forEach((btn) => {
    let armed = false, t = null;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'पक्का?';
        btn.classList.add('armed');
        clearTimeout(t);
        t = setTimeout(() => { armed = false; btn.textContent = 'हटाएँ'; btn.classList.remove('armed'); }, 6000);
        return;
      }
      clearTimeout(t);
      btn.disabled = true;
      try {
        await api('/api/dev/elections/' + encodeURIComponent(btn.dataset.devDel) + '/delete', { method: 'POST' });
        exploreCache = null;
        toast('चुनाव साइट से हटा दिया (कोड ' + btn.dataset.devDel + ')', 'ok');
        renderDeveloper();
      } catch (err) {
        toast(err.message, 'err');
        btn.disabled = false;
        armed = false;
        btn.textContent = 'हटाएँ';
        btn.classList.remove('armed');
      }
    });
  });

  $$('[data-dev-close]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api('/api/elections/' + btn.dataset.devClose + '/' + btn.dataset.action, { method: 'POST' });
        toast('स्थिति बदल गई', 'ok');
        exploreCache = null;
        renderDeveloper();
      } catch (e) {
        toast(e.message, 'err');
        btn.disabled = false;
      }
    });
  });
}

function openDevUserModeration(userId) {
  const u = devData && Array.isArray(devData.users) ? devData.users.find((x) => x.id === userId) : null;
  if (!u) { toast('यह खाता सूची में नहीं मिला — ताज़ा करें।', 'err'); return; }
  const info = devAccountStatusInfo(u);
  if (!['active', 'banned'].includes(info.status)) {
    toast('इस खाते पर अब कोई कार्रवाई उपलब्ध नहीं है।', 'err');
    return;
  }
  const banned = info.status === 'banned';
  openDevModal(`<h3>खाता नियंत्रण</h3>
    <p style="margin-top:2px"><b>${esc(u.name)}</b>${u.username ? ' <span class="code-chip">@' + esc(u.username) + '</span>' : ' <span class="muted">(username नहीं)</span>'}</p>
    <p class="muted" style="margin-top:6px">मौजूदा स्थिति: ${devAccountStatusHTML(u)}</p>

    <label for="devModReason" style="display:block;margin-top:16px"><b>कारण</b> <span class="muted small">(वैकल्पिक — रोक लगने पर उपयोगकर्ता को login संदेश में दिख सकता है)</span></label>
    <input id="devModReason" type="text" maxlength="200" value="${esc(u.banReason || '')}" placeholder="जैसे: गलत/फ़र्ज़ी खाता, नियम तोड़ना, दुरुपयोग…" style="margin-top:7px;width:100%" />

    <label for="devModDays" style="display:block;margin-top:14px"><b>अस्थायी रोक के दिन</b> <span class="muted small">(1–3650 दिन; अवधि पूरी होते ही खाता अपने आप चालू होगा)</span></label>
    <input id="devModDays" type="number" inputmode="numeric" min="1" max="3650" step="1" value="7" style="margin-top:7px;width:150px" />

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:18px">
      <button class="btn btn-danger" id="devBanTempBtn">${banned ? 'रोक की अवधि बदलें' : 'इतने दिन रोकें'}</button>
      <button class="btn btn-danger" id="devBanPermBtn">स्थायी रोक लगाएँ</button>
      ${banned ? '<button class="btn btn-primary" id="devUnbanBtn">रोक हटाएँ</button>' : ''}
      <button class="btn btn-danger" id="devDeleteUserBtn">खाता हटाएँ</button>
    </div>

    <div class="alert bad" style="margin-top:16px">
      <b>ध्यान दें:</b> रोक लगाते या खाता हटाते ही इस खाते के सभी login session तुरंत बंद हो जाएँगे।
      <b>खाता हटाना वापस नहीं होगा</b> — PIN/रिकवरी भी बंद हो जाएगी और वही username फिर किसी को नहीं मिलेगा।
      पुराने चुनाव और वोटों की गिनती परिणामों की सच्चाई के लिए बिना नाम के सुरक्षित रहेगी।
      Developer द्वारा हटाए खाते के उसी जुड़े फ़ोन से सीधा नया खाता भी नहीं बनेगा; वापसी के लिए developer-approved appeal लगेगा। अगर खाता बाद में फिर चालू करना पड़ सकता है, तो हटाने की बजाय <b>स्थायी रोक</b> चुनें।
    </div>`);

  const buttons = ['devBanTempBtn', 'devBanPermBtn', 'devUnbanBtn', 'devDeleteUserBtn']
    .map((id) => document.getElementById(id)).filter(Boolean);
  const setBusy = (busy) => buttons.forEach((b) => { b.disabled = busy; });
  const disarm = (btn) => {
    if (!btn) return;
    clearTimeout(btn._modTimer);
    btn.dataset.armed = '';
    btn.classList.remove('armed');
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  };

  const run = async (action, btn) => {
    const reasonEl = document.getElementById('devModReason');
    const daysEl = document.getElementById('devModDays');
    const reason = reasonEl ? reasonEl.value.trim() : '';
    const days = daysEl ? Number(daysEl.value) : NaN;
    if (action === 'ban-temporary' && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      toast('रोक के दिन सही लिखें — 1 से 3650 के बीच पूरा नंबर होना चाहिए।', 'err');
      if (daysEl) daysEl.focus();
      return;
    }
    const needsConfirm = action !== 'unban';
    if (needsConfirm && btn && btn.dataset.armed !== '1') {
      buttons.forEach((b) => { if (b !== btn) disarm(b); });
      btn.dataset.armed = '1';
      btn.dataset.label = btn.textContent;
      btn.textContent = action === 'delete' ? 'पक्का खाता हटाएँ?' : 'पक्का रोक लगाएँ?';
      btn.classList.add('armed');
      clearTimeout(btn._modTimer);
      btn._modTimer = setTimeout(() => disarm(btn), 7000);
      return;
    }
    if (btn) clearTimeout(btn._modTimer);
    setBusy(true);
    try {
      const res = await api('/api/dev/users/' + encodeURIComponent(u.id) + '/moderate', {
        method: 'POST',
        body: {
          action,
          days: action === 'ban-temporary' ? days : undefined,
          reason: action === 'unban' ? '' : reason,
          confirm: action === 'delete',
        },
      });
      toast(res.message || 'कार्रवाई हो गई।', 'ok');
      const closeBtn = document.getElementById('devModalClose');
      if (closeBtn) closeBtn.click();
      await refreshDevData();
    } catch (err) {
      toast(err.message || 'कार्रवाई नहीं हो सकी।', 'err');
      setBusy(false);
      disarm(btn);
    }
  };

  const tempBtn = document.getElementById('devBanTempBtn');
  if (tempBtn) tempBtn.addEventListener('click', () => run('ban-temporary', tempBtn));
  const permBtn = document.getElementById('devBanPermBtn');
  if (permBtn) permBtn.addEventListener('click', () => run('ban-permanent', permBtn));
  const unbanBtn = document.getElementById('devUnbanBtn');
  if (unbanBtn) unbanBtn.addEventListener('click', () => run('unban', unbanBtn));
  const deleteBtn = document.getElementById('devDeleteUserBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', () => run('delete', deleteBtn));
}

function openDevModal(html) {
  const modal = document.getElementById('devModal');
  if (!modal) return;
  modal.innerHTML = `<div class="sym-sheet dev-modal-sheet" role="dialog" aria-modal="true">
    <div class="sym-sheet-head">
      <div style="flex:1">${html.split('</h3>')[0]}</div>
      <button class="icon-btn" id="devModalClose" aria-label="बंद करें">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <div class="dev-modal-body">${html.split('</h3>').slice(1).join('</h3>')}</div>
  </div>`;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  const close = () => { modal.classList.remove('open'); document.body.style.overflow = ''; };
  document.getElementById('devModalClose').addEventListener('click', close);
  modal.addEventListener('click', (ev) => { if (ev.target === modal) close(); });
}

function renderDevLogin() {
  setActiveNav('');
  app.innerHTML = `
  <section class="dev-login-page">
    <div class="wrap wrap-narrow">
      <div class="dev-login-card">
        <div class="dev-lock">${ICON.shield}</div>
        <div class="kicker" style="color:#ffd08a">डेवलपर एक्सेस</div>
        <h1>सिर्फ़ डेवलपर के लिए</h1>
        <p>यहाँ से आप हर यूज़र, उसके बनाए चुनाव और किसने किसको वोट दिया — सब देख सकते हैं। पासवर्ड डालिए।</p>
        <form id="devLoginForm" autocomplete="off">
          <input id="devPassword" type="password" placeholder="डेवलपर पासवर्ड" aria-label="डेवलपर पासवर्ड" />
          <button class="btn btn-saffron btn-lg" type="submit" id="devLoginBtn">अनलॉक करें</button>
        </form>
        <div class="field-error" id="devLoginErr"></div>
        <p class="dev-login-note">यह पासवर्ड सर्वर पर सुरक्षित रहता है। गलत पासवर्ड पर 10 मिनट में सिर्फ़ 8 कोशिशें मिलती हैं।</p>
        <a class="dev-back" href="#/">← होम पर वापस</a>
      </div>
    </div>
  </section>`;

  const form = document.getElementById('devLoginForm');
  const input = document.getElementById('devPassword');
  const btn = document.getElementById('devLoginBtn');
  const errBox = document.getElementById('devLoginErr');
  input.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errBox.textContent = '';
    btn.disabled = true;
    btn.textContent = 'जाँच हो रही है…';
    try {
      const res = await api('/api/dev/login', { method: 'POST', body: { password: input.value } });
      state.devToken = res.devToken;
      store.set('jm_dev_token', res.devToken);
      ownerGateEnable();
      devTab = 'active';   /* खुलते ही "चालू चुनाव" — हर चुनाव का अलग कार्ड */
      toast('डेवलपर एक्सेस खुल गया', 'ok');
      renderDeveloper();
    } catch (e) {
      errBox.textContent = e.message;
      btn.disabled = false;
      btn.textContent = 'अनलॉक करें';
      input.select();
    }
  });
}

/* =====================================================================
   HOW / DISCLAIMER
   ===================================================================== */

function renderHow() {
  setActiveNav('how');
  clearPoll();
  app.innerHTML = `
  <section class="section">
    <div class="wrap">
      <div class="kicker">गाइड</div>
      <h2 style="font-size:clamp(26px,3.6vw,37px);letter-spacing:-.025em">कैसे काम करता है?</h2>
      <p class="muted" style="margin:9px 0 20px;max-width:46em">जनमत एक सरल ऑनलाइन मतदान मंच है — गाँव, कॉलोनी, सोसाइटी, स्कूल या किसी भी संस्था के अपने चुनाव के लिए।</p>
      ${HOW_SECTION}
      <div class="panel">
        <div class="section-title"><h2>अक्सर पूछे जाने वाले सवाल</h2></div>
        <div class="faq">
          <div><h4>लॉगिन में मोबाइल नंबर क्यों नहीं?</h4><p>यह मंच स्थायी username + 6–10 अंकों के PIN पर चलता है — मोबाइल, Gmail या OTP नहीं माँगा जाता। आपका नाम सिर्फ़ प्रोफ़ाइल में दिखता है। PIN भूलने पर लॉगिन कार्ड वाला रिकवरी कोड काम आएगा; username भूलने पर Team Janmat को आवेदन भेजना होगा।</p></div>
          <div><h4>एक व्यक्ति कितनी बार वोट कर सकता है?</h4><p>हर चुनाव में आपका सिर्फ़ <b>एक वोट</b> गिना जाता है — आपके खाते से एक, और आपके डिवाइस से भी एक। दूसरे नाम से भी उसी डिवाइस से दोबारा वोट नहीं हो सकता।</p></div>
          <div><h4>एक दिन में कितने चुनाव बना सकते हैं?</h4><p>हर उपयोगकर्ता 1 दिन (IST) में अधिकतम <b>2 चुनाव</b> बना सकता है। सीमा आधी रात (IST) पर रीसेट होती है।</p></div>
          <div><h4>किसने किसको वोट दिया, कौन देख सकता है?</h4><p>सिर्फ़ <b>डेवलपर</b> (पासवर्ड से)। चुनाव बनाने वाला भी नहीं देख सकता कि किसने किसको वोट दिया — उसे भी सिर्फ़ गिनती दिखती है। सार्वजनिक रूप से सबको सिर्फ़ परिणाम दिखता है।</p></div>
          <div><h4>चुनाव का समय (टाइमर) कैसे तय होता है?</h4><p>चुनाव बनाते समय आप खुद समय चुनते हैं — 1 मिनट, 2 मिनट, 1 घंटा, 2 घंटे, 24 घंटे, या अपनी कोई भी संख्या (50, 100…). समय पूरा होते ही चुनाव <b>अपने आप बंद</b> हो जाता है और परिणाम घोषित हो जाता है।</p></div>
          <div><h4>क्या मैं चुनाव बीच में बंद या हटा सकता हूँ?</h4><p>नहीं। टाइमर चालू होने के बाद चुनाव <b>लॉक</b> रहता है — न जल्दी बंद होगा, न हटेगा। समय पूरा होने के बाद आप उसे हटा (डिलीट) सकते हैं। अगर आप लॉगआउट भी कर दें, चुनाव साइट पर चलता रहेगा और तय समय पर खुद बंद होगा।</p></div>
          <div><h4>लॉगिन कार्ड क्या है?</h4><p>नाम लिखकर लॉगिन करते ही आपके नाम वाली एक सुंदर इमेज डाउनलोड होती है। उस पर लिखा रहता है — “इसे अच्छे से सँभाल कर रखें, इसी से आप लॉगिन कर पाएंगे”, और नीचे दोनों पते (GitHub Pages व Render) वॉटरमार्क की तरह रहते हैं।</p></div>
          <div><h4>क्या परिणाम स्थायी रहते हैं?</h4><p>हाँ। वोट और परिणाम सर्वर पर सेव होते हैं। Upstash Redis जोड़ने पर डेटा होस्टिंग रीस्टार्ट होने पर भी सुरक्षित रहता है।</p></div>
          <div><h4>क्या यह सरकारी चुनाव के लिए है?</h4><p>नहीं। यह गैर-सरकारी, सामुदायिक मतदान मंच है। <a href="#/disclaimer">डिस्क्लेमर</a> ज़रूर पढ़ें।</p></div>
        </div>
      </div>
      <div style="margin-top:26px;text-align:center"><a class="btn btn-primary btn-lg" href="#/create">अपना चुनाव बनाएँ →</a></div>
    </div>
  </section>`;
}

function renderDisclaimer() {
  setActiveNav('');
  clearPoll();
  app.innerHTML = `
  <section class="section">
    <div class="wrap wrap-narrow">
      <div class="kicker">कानूनी सूचना</div>
      <h2 style="font-size:clamp(25px,3.4vw,35px);letter-spacing:-.025em">डिस्क्लेमर, नियम व गोपनीयता</h2>
      <div class="legal-doc">
        <div class="legal-warn">
          ${ICON.warn}
          <div><b>ज़रूरी सूचना:</b> यह वेबसाइट (“जनमत”) एक <b>निजी, स्वतंत्र और गैर-सरकारी</b> ऑनलाइन मतदान मंच है। इसका भारत सरकार, किसी राज्य सरकार, किसी पंचायत/नगरपालिका, भारत निर्वाचन आयोग (Election Commission of India) या किसी अन्य सरकारी/वैधानिक निकाय से <b>किसी भी प्रकार का संबंध नहीं</b> है।</div>
        </div>

        <h3>1. मंच का उद्देश्य</h3>
        <p>यह मंच केवल गाँव, कॉलोनी, सोसाइटी, स्कूल, क्लब, संस्था आदि के <b>सामुदायिक/निजी सर्वेक्षण व आंतरिक मतदान</b> के लिए है। यहाँ होने वाला कोई भी मतदान कानूनी रूप से मान्य, आधिकारिक या सरकारी चुनाव परिणाम नहीं है।</p>

        <h3>2. क्या नहीं करें</h3>
        <ul>
          <li>इस मंच का उपयोग किसी सरकारी, विधायी, न्यायिक या संवैधानिक पद के चुनाव के लिए न करें।</li>
          <li>इसे किसी सरकारी चुनाव/मतदान का प्रतिरूप या विकल्प बताकर प्रचारित न करें।</li>
          <li>किसी व्यक्ति की पहचान, धर्म, जाति या राजनीतिक दल के आधार पर द्वेष/भेदभाव न फैलाएँ।</li>
          <li>बिना अनुमति किसी और का नाम इस्तेमाल करके लॉगिन/वोट न करें।</li>
          <li>साइट को हैक करने, रोबोट से वोट बढ़ाने या तोड़ने की कोशिश न करें।</li>
        </ul>

        <h3>3. ज़िम्मेदारी की सीमा</h3>
        <p>यह मंच “जैसा है” (as-is) उपलब्ध कराया गया है। मंच के संचालक किसी भी प्रकार के नुकसान, विवाद, गलत परिणाम, डेटा हानि या इस साइट के उपयोग से होने वाली किसी भी कानूनी/वित्तीय/सामाजिक क्षति के लिए <b>उत्तरदायी नहीं</b> होंगे। उपयोगकर्ता अपने जोखिम पर इसका उपयोग करता है।</p>

        <h3>4. मतदान नियम</h3>
        <ul>
          <li><b>एक डिवाइस = एक वोट</b> प्रति चुनाव। एक ही डिवाइस से दूसरे नाम पर भी दोबारा वोट नहीं हो सकता।</li>
          <li>हर उपयोगकर्ता <b>1 दिन में अधिकतम 2 चुनाव</b> बना सकता है।</li>
          <li>लॉगिन स्थायी username + गुप्त PIN से है (कोई मोबाइल/Gmail/OTP नहीं)। एक जैसे नाम के कई लोग हो सकते हैं, पर हर username सिर्फ़ एक खाते का होता है। अपना username, PIN और रिकवरी कोड सुरक्षित रखना उपयोगकर्ता की ज़िम्मेदारी है। एक फ़ोन पर सीधे एक ही खाता बनता है; दूसरा खाता Team Janmat की मंज़ूरी से बनेगा।</li>
        </ul>

        <h3>5. गोपनीयता व डेटा</h3>
        <ul>
          <li>मतदान चलने के दौरान सार्वजनिक रूप से उम्मीदवारों की गिनती नहीं दिखती। चुनाव बंद होने के बाद अंतिम परिणाम सभी को दिखता है। चलती गिनती केवल डेवलपर देख सकता है।</li>
          <li>किसने किसको वोट दिया और किसने कौन-सा चुनाव बनाया — यह जानकारी <b>केवल डेवलपर</b> पासवर्ड से देख सकता है।</li>
          <li>तकनीकी रूप से डिवाइस-फिंगरप्रिंट व IP पता सीमा-नियंत्रण (एक डिवाइस एक वोट) के लिए संग्रहीत हो सकते हैं।</li>
          <li>डेटा सर्वर/डेटाबेस पर सुरक्षित रखा जाता है; कोई संवेदनशील जानकारी तीसरे पक्ष को नहीं बेची जाती।</li>
        </ul>

        <h3>6. सामग्री व गोपनीयता</h3>
        <p>उपयोगकर्ता जो नाम, पार्टी या जानकारी जोड़ता है उसकी ज़िम्मेदारी उसकी स्वयं की है। मंच संचालक किसी भी अपमानजनक/अवैध सामग्री को हटाने का अधिकार रखते हैं।</p>

        <h3>7. शिकायत, कंटेंट हटाना और रिकॉर्ड</h3>
        <ul>
          <li><b>शिकायत कहाँ करें:</b> <a href="#/grievance">शिकायत पेज</a> के फ़ॉर्म से, या ईमेल <a class="link" href="mailto:pawanverma992930@gmail.com">pawanverma992930@gmail.com</a> पर (Grievance Officer: जनमत का संचालक)।</li>
          <li><b>24 घंटे:</b> शिकायत मिलने की पुष्टि और ticket नंबर।</li>
          <li><b>15 दिन:</b> शिकायत का हल या लिखित जवाब।</li>
          <li><b>36 घंटे:</b> किसी अदालत या सक्षम सरकारी एजेंसी के आदेश/नोटिस मिलने पर उस कंटेंट को हटाना या बंद करना (IT Act की धारा 79(3)(b) व IT Rules 2021 के नियम 3(1)(d) के अनुसार)।</li>
          <li><b>72 घंटे:</b> निजी तस्वीरें/मॉर्फ्ड इमेज या नक़ल (impersonation) वाली शिकायत पर कार्रवाई।</li>
          <li><b>रिकॉर्ड:</b> शिकायत और उससे जुड़ी जानकारी कम-से-कम <b>180 दिन</b> सुरक्षित रखी जाती है; जाँच चलने पर उस अवधि तक और उसके बाद 90 दिन तक।</li>
          <li><b>आपकी ज़िम्मेदारी:</b> झूठी या दूसरों को नुकसान पहुँचाने वाली शिकायत न करें — ऐसा करने पर आपका उपयोग बंद किया जा सकता है।</li>
        </ul>

        <div class="legal-foot">
          <p><b>सारांश:</b> यह शादी, सोसाइटी, गाँव, स्कूल या क्लब जैसे सामुदायिक फ़ैसलों के लिए एक सुविधाजनक टूल है — सरकारी चुनाव का विकल्प नहीं।</p>
        </div>
      </div>
      <div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/">होम पर जाएँ</a>
        <a class="btn btn-ghost" href="#/settings">सेटिंग्स</a>
      </div>
    </div>
  </section>`;
}

/* =====================================================================
   TERMS & PRIVACY
   ===================================================================== */

function renderTerms() {
  setActiveNav('');
  clearPoll();
  app.innerHTML = `
  <section class="section">
    <div class="wrap wrap-narrow">
      <div class="kicker">कानूनी</div>
      <h2 style="font-size:clamp(25px,3.4vw,35px);letter-spacing:-.025em">नियम व शर्तें (Terms &amp; Conditions)</h2>
      <p class="muted" style="margin:8px 0 20px;font-size:13.4px">अंतिम अपडेट: ${esc(new Date().toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>

      <div class="legal-doc">
        <div class="legal-warn">
          ${ICON.warn}
          <div><b>ज़रूरी:</b> यह मंच <b>निजी, स्वतंत्र और गैर-सरकारी</b> है। इसका किसी सरकार, पंचायत, नगरपालिका, न्यायालय या भारत निर्वाचन आयोग से कोई संबंध नहीं है। यहाँ के परिणाम किसी आधिकारिक चुनाव के लिए मान्य नहीं हैं।</div>
        </div>

        <h3>1. स्वीकृति</h3>
        <p>साइट का उपयोग करने, username से लॉगिन करने, चुनाव बनाने या वोट देने का मतलब है कि आप इन शर्तों और <a href="#/privacy">गोपनीयता नीति</a> से सहमत हैं। यदि आप सहमत नहीं हैं तो कृपया साइट का उपयोग न करें।</p>

        <h3>2. पात्रता</h3>
        <ul>
          <li>आपको अपना <b>वास्तविक या स्थायी नाम</b> लिखना चाहिए और अपने खाते के लिए <b>मज़बूत पासवर्ड</b> रखना चाहिए (मोबाइल/OTP नहीं लगता)।</li>
          <li>किसी और का नाम लिखकर उसकी पहचान का दुरुपयोग करना मना है।</li>
          <li>18 वर्ष से कम आयु के उपयोगकर्ताओं को अभिभावक की सहमति से ही उपयोग करना चाहिए।</li>
        </ul>

        <h3>3. मंच का उद्देश्य</h3>
        <p>यह मंच केवल <b>सामुदायिक/निजी मतदान</b> के लिए है — जैसे गाँव, कॉलोनी, सोसाइटी, स्कूल, क्लब, संस्था या मित्र-मंडली के आंतरिक फ़ैसले। यह किसी भी सरकारी, विधायी, न्यायिक या संवैधानिक पद के चुनाव के लिए मान्य नहीं है।</p>

        <h3>4. मतदान नियम</h3>
        <ul>
          <li><b>एक डिवाइस = एक वोट</b> प्रति चुनाव। एक ही डिवाइस से दूसरे नाम लेकर भी दोबारा वोट नहीं हो सकता।</li>
          <li>हर उपयोगकर्ता <b>एक दिन (IST) में अधिकतम 2 चुनाव</b> बना सकता है।</li>
          <li>“Username + PIN = आपका खाता” — वही username और सही PIN लिखने पर ही खाता खुलता है। उसी नाम के दूसरे व्यक्ति का username अलग होगा और खाता भी अलग रहेगा।</li>
          <li>आयोजक कभी भी अपना चुनाव बंद कर सकता है; बंद चुनाव में वोट नहीं पड़ सकते।</li>
        </ul>

        <h3>5. निषिद्ध गतिविधियाँ</h3>
        <ul>
          <li>साइट को हैक करना, बॉट/स्क्रिप्ट से वोट बढ़ाना या सिस्टम में बाधा डालना।</li>
          <li>अपमानजनक, सांप्रदायिक, धमकी भरा या अवैध नाम/सामग्री जोड़ना।</li>
          <li>किसी सरकारी चुनाव का प्रतिरूप बताकर भ्रम फैलाना।</li>
        </ul>
        <p>ऐसा करने पर खाता कुछ दिनों के लिए या स्थायी रूप से बंद किया जा सकता है, या खाता/चुनाव हटाया जा सकता है। रोक लगने पर लॉगिन संदेश में रोक की अवधि और दिया गया कारण दिखेगा; यदि आपको लगता है कि रोक गलत लगी है तो <a href="#/grievance">शिकायत पेज</a> से पुनर्विचार माँग सकते हैं।</p>

        <h3>6. सामग्री की ज़िम्मेदारी</h3>
        <p>उम्मीदवारों के नाम, पार्टी, चिन्ह और जानकारी आयोजक द्वारा भरी जाती है — उसकी सत्यता और अनुमति की ज़िम्मेदारी आयोजक की है। मंच केवल तकनीकी सुविधा देता है।</p>

        <h3>7. ज़िम्मेदारी की सीमा</h3>
        <p>मंच “जैसा है” (as-is) और “जैसा उपलब्ध है” के आधार पर दिया गया है। किसी भी प्रकार के नुकसान, विवाद, डेटा हानि, तकनीकी रुकावट, गलत परिणाम या इस साइट के उपयोग से होने वाली किसी भी हानि के लिए संचालक <b>उत्तरदायी नहीं</b> होंगे। उपयोग अपने जोखिम पर करें।</p>

        <h3>8. बदलाव</h3>
        <p>ये शर्तें कभी भी अपडेट हो सकती हैं। जारी रखने का मतलब है नए नियमों की स्वीकृति।</p>

        <div class="legal-foot">
          <p><b>संपर्क / शिकायत:</b> साइट के संचालक (डेवलपर) से <a href="#/grievance">शिकायत पेज</a> के फ़ॉर्म से, या ईमेल <a class="link" href="mailto:pawanverma992930@gmail.com">pawanverma992930@gmail.com</a> पर संपर्क किया जा सकता है। हर शिकायत 24 घंटे में स्वीकार और 15 दिन में हल की जाती है।</p>
        </div>
      </div>

      <div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/privacy">गोपनीयता नीति पढ़ें</a>
        <a class="btn btn-ghost" href="#/disclaimer">डिस्क्लेमर</a>
      </div>
    </div>
  </section>`;
}

function renderPrivacy() {
  setActiveNav('');
  clearPoll();
  app.innerHTML = `
  <section class="section">
    <div class="wrap wrap-narrow">
      <div class="kicker">आपका डेटा</div>
      <h2 style="font-size:clamp(25px,3.4vw,35px);letter-spacing:-.025em">गोपनीयता नीति (Privacy Policy)</h2>
      <p class="muted" style="margin:8px 0 20px;font-size:13.4px">अंतिम अपडेट: ${esc(new Date().toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric' }))}</p>

      <div class="legal-doc">
        <div class="legal-warn">
          ${ICON.shield}
          <div><b>छोटा सार:</b> आपका नाम, डिवाइस पहचान और वोट सिर्फ़ चुनाव चलाने के लिए ज़रूरी कम-से-कम डेटा है। किसी को नहीं बेचा जाता। किसने किसको वोट दिया — यह सिर्फ़ डेवलपर देख सकता है, और आप कभी भी अपना खाता हटा सकते हैं।</div>
        </div>

        <h3>1. हम कौन-सा डेटा लेते हैं</h3>
        <ul>
          <li><b>नाम</b> — जो आप लॉगिन में लिखते हैं।</li>
          <li><b>पासवर्ड (सिर्फ़ हैश के रूप में)</b> — आपका असली पासवर्ड 서버 पर कभी नहीं रखा जाता; सिर्फ़ उसका पहचान-रहित हैश रखा जाता है, जिससे पासवर्ड वापस पढ़ा नहीं जा सकता। रिकवरी कोड का भी सिर्फ़ हैश रहता है।</li>
          <li><b>टोकन</b> — आपके लॉगिन सत्र को याद रखने के लिए एक तकनीकी कोड। ब्राउज़र में आपका token रहता है और सर्वर पर उसका सिर्फ़ हैश रहता है; सत्र की समय-सीमा होती है।</li>
          <li><b>डिवाइस पहचान</b> — “एक डिवाइस = एक वोट” लागू करने के लिए डिवाइस फिंगरप्रिंट का हैश (बिना कच्चे डेटा के)।</li>
          <li><b>IP पता और ब्राउज़र जानकारी</b> — सिर्फ़ दुरुपयोग रोकने और सीमा लागू करने के लिए (सर्वर लॉग में)।</li>
          <li><b>वोट</b> — आपने किस चुनाव में किसको वोट दिया (गिनती और परिणाम के लिए)।</li>
          <li><b>आपके बनाए चुनाव</b> — शीर्षक, गाँव/ज़िला/राज्य, उम्मीदवार।</li>
        </ul>

        <h3>2. डेटा किसको दिखता है</h3>
        <ul>
          <li><b>सबको (सार्वजनिक):</b> मतदान के दौरान चुनाव का नाम, जगह और उम्मीदवार। कुल पड़े वोट, उम्मीदवारों के वोट व प्रतिशत चुनाव बंद होने के बाद दिखते हैं।</li>
          <li><b>आयोजक को:</b> तय नियमों के अनुसार अपने चुनाव का प्रबंधन। मतदान चलने के दौरान कुल संख्या और उम्मीदवार-गिनती उसे भी नहीं दिखती, और वह यह भी <b>नहीं</b> देख सकता कि किसने किसको वोट दिया।</li>
          <li><b>डेवलपर को (पासवर्ड से):</b> पूरा विवरण — हर यूज़र का नाम, उसके चुनाव और किसने किसको वोट दिया। यह सिर्फ़ साइट के संचालक के पास है।</li>
          <li><b>किसी को नहीं बेचा जाता</b> और किसी विज्ञापन कंपनी से साझा नहीं किया जाता।</li>
        </ul>

        <h3>3. डेटा कहाँ रखा जाता है</h3>
        <p>चुनाव और वोट सर्वर के डेटाबेस में रखे जाते हैं (सेल्फ़-होस्टेड फ़ाइल या Upstash Redis)। होस्टिंग प्रदाता के अपने सर्वर स्थान के हिसाब से डेटा भिन्न देशों में हो सकता है।</p>

        <h3>4. कितने समय तक</h3>
        <ul>
          <li><b>चुनाव + परिणाम:</b> स्थायी रूप से (क्योंकि परिणाम सुरक्षित रखना उद्देश्य है)।</li>
          <li><b>आपका नाम/खाता:</b> जब तक आप हटाने का अनुरोध न करें।</li>
          <li><b>लॉगिन सत्र:</b> लगभग 6 महीने तक वैध।</li>
        </ul>

        <h3>5. आपके अधिकार</h3>
        <ul>
          <li><b>अपना खाता हटाना:</b> <a href="#/settings/account">सेटिंग्स → खाता</a> से एक क्लिक में। हटाने पर आपका नाम मिट जाता है और पहचान नहीं रहती; आपके वोटों की गिनती (बिना नाम) बरकरार रहती है ताकि चुनाव के परिणाम न बदलें।</li>
          <li><b>जानना:</b> आप अपने नाम से जुड़े वोट “मेरे वोट” में देख सकते हैं।</li>
          <li><b>सुधार:</b> अपना नाम फिर से उसी रूप में लिखकर लॉगिन करें।</li>
        </ul>

        <h3>6. सुरक्षा</h3>
        <p>डेवलपर पासवर्ड सर्वर पर सुरक्षित रहता है, सत्र समय-सीमा (12 घंटे) और सीमित प्रयास लागू हैं। फिर भी इंटरनेट पर कोई भी सिस्टम 100% अभेद्य नहीं होता — अत्यंत संवेदनशील जानकारी न डालें।</p>

        <h3>7. कुकीज़ / ट्रैकिंग</h3>
        <p>हम विज्ञापन कुकीज़ या थर्ड-पार्टी ट्रैकर नहीं लगाते। आपकी पसंद (थीम), लॉगिन सत्र और "एक डिवाइस = एक वोट" के लिए डिवाइस पहचान आपके ब्राउज़र के localStorage, कुकी और IndexedDB में रह सकती है। ब्राउज़र का पूरा साइट-डेटा साफ़ करने पर ये हट जाते हैं, पर तब आपको फिर से username + PIN से लॉगिन करना होगा।</p>

        <h3>8. बच्चे</h3>
        <p>यह मंच 13 वर्ष से कम बच्चों के लिए नहीं बनाया गया; अभिभावक की सहमति के बिना उपयोग न करें।</p>

        <h3>9. शिकायत कहाँ करें</h3>
        <p>डेटा या साइट से जुड़ी कोई भी शिकायत <a href="#/grievance">शिकायत पेज</a> के फ़ॉर्म से, या ईमेल <a class="link" href="mailto:pawanverma992930@gmail.com">pawanverma992930@gmail.com</a> पर भेजें। शिकायत 24 घंटे में स्वीकार और 15 दिन में हल की जाती है।</p>

        <div class="legal-foot">
          <p><b>सहमति:</b> साइट का उपयोग जारी रखने का अर्थ है कि आप इस नीति से सहमत हैं।</p>
        </div>
      </div>

      <div style="margin-top:22px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/terms">नियम व शर्तें पढ़ें</a>
        <a class="btn btn-ghost" href="#/settings/account">खाता प्रबंधन</a>
      </div>
    </div>
  </section>`;
}

/* =====================================================================
   ROUTER
   ===================================================================== */

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  return { parts: pathPart.split('/').filter(Boolean), query: new URLSearchParams(queryPart || '') };
}

/* 🛡️ किसी भी पेज में गड़बड़ी हो तो सफ़ेद/खाली पेज न दिखे — साफ़ संदेश + बटन */
function safeRender(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.catch === 'function') {
      return out.catch((e) => showPageError(name, e));
    }
    return out;
  } catch (e) {
    return showPageError(name, e);
  }
}

function showPageError(name, e) {
  try { console.warn('render error in', name, e); } catch (_) {}
  const box = document.getElementById('app');
  if (!box) return;
  box.innerHTML = `
  <section class="section"><div class="wrap wrap-narrow">
    <div class="empty">
      <div class="em-ico">${ICON.warn}</div>
      <h3>यह पेज खुल नहीं पाया</h3>
      <p>कोई तकनीकी गड़बड़ी हुई${name ? ' (' + esc(String(name)) + ')' : ''}। नीचे से फिर कोशिश करें — आपका डेटा सुरक्षित है।</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
        <button class="btn btn-primary" id="errRetry">फिर कोशिश करें</button>
        <a class="btn btn-ghost" href="#/">होम पर जाएँ</a>
        <a class="btn btn-ghost" href="#/explore">सारे चुनाव</a>
      </div>
    </div>
  </div></section>`;
  const r = document.getElementById('errRetry');
  if (r) r.addEventListener('click', () => { location.reload(); });
}

/* 🔎 सर्च/पुराने लिंक से आने वाले लोग /explore, /how जैसे पते पर आते हैं
   (बिना #) — उन्हें सही पेज पर पहुँचा दो, खाली/404 पेज न दिखे। */
(function normalizePathLink() {
  try {
    const path = location.pathname.replace(/^\/+|\/+$/g, '');
    if (!path || /\.(html?|png|jpe?g|svg|css|js|json|ico|txt|webmanifest)$/i.test(path)) return;
    if (location.hash && location.hash.length > 1) return;
    const known = ['explore', 'how', 'login', 'create', 'settings', 'developer', 'disclaimer', 'terms', 'privacy'];
    const first = path.split('/')[0].toLowerCase();
    if (known.includes(first)) {
      history.replaceState(null, '', '/' + '#' + '/' + path + location.search);
    } else {
      history.replaceState(null, '', '/' + '#/');
    }
  } catch (_) {}
})();


/* =====================================================================
   📩 शिकायत / Grievance — IT Rules 2021, Rule 3(2)
   हर शिकायत 24 घंटे में स्वीकार, 15 दिन में हल। कोर्ट/सरकारी आदेश पर 36 घंटे में हटाना।
   ===================================================================== */
function renderGrievance() {
  setActiveNav('');
  clearPoll();
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const eCode = (q.get('e') || '').trim().toUpperCase().slice(0, 10);

  app.innerHTML = `
  <section class="section">
    <div class="wrap wrap-narrow">
      <div class="kicker">शिकायत / Grievance</div>
      <h2 style="font-size:clamp(25px,3.4vw,35px);letter-spacing:-.025em">कुछ गड़बड़ है? हमें बताइए</h2>
      <p class="muted" style="margin:8px 0 20px;font-size:13.4px">
        यहाँ भेजी हर शिकायत दर्ज होती है और डेवलपर के पैनल में तुरंत दिखती है। किसी सरकारी चुनाव से इस साइट का कोई संबंध नहीं है।
      </p>

      <div class="legal-doc">
        <div class="legal-warn">
          ${ICON.shield}
          <div>
            <b>Grievance Officer:</b> जनमत का संचालक (डेवलपर)।<br>
            <b>संपर्क:</b> नीचे का फ़ॉर्म (सबसे तेज़)${GRIEVANCE_EMAIL ? ' · ईमेल: <a class="link" href="mailto:' + esc(GRIEVANCE_EMAIL) + '?subject=%E0%A4%9C%E0%A4%A8%E0%A4%AE%E0%A4%A4%20%E0%A4%B6%E0%A4%BF%E0%A4%95%E0%A4%BE%E0%A4%AF%E0%A4%A4">' + esc(GRIEVANCE_EMAIL) + '</a>' : ''}
            <br><span class="muted small">शिकायत में अपना नाम और संपर्क (फ़ोन/ईमेल) ज़रूर लिखें — जवाब देने के लिए ज़रूरी है।</span>
          </div>
        </div>

        <h3>समय-सीमा (हमारा वादा)</h3>
        <ul>
          <li><b>24 घंटे:</b> शिकायत मिलने की पुष्टि (ticket नंबर मिलेगा)।</li>
          <li><b>15 दिन:</b> शिकायत का हल या साफ़ जवाब।</li>
          <li><b>36 घंटे:</b> अदालत या सरकारी आदेश मिलने पर उस कंटेंट को हटाना/बंद करना।</li>
          <li><b>72 घंटे:</b> निजी तस्वीरें, मॉर्फ्ड इमेज या किसी की नक़ल (impersonation) वाली शिकायत पर कार्रवाई।</li>
        </ul>

        <h3>किस बारे में शिकायत कर सकते हैं</h3>
        <ul>
          <li>किसी चुनाव में <b>गलत/अपमानजनक नाम</b> या फ़र्ज़ी उम्मीदवार।</li>
          <li>किसी की <b>निजी जानकारी</b> बिना अनुमति डाली गई हो।</li>
          <li>किसी और के नाम से <b>फ़र्ज़ी वोट</b> या फ़र्ज़ी चुनाव।</li>
          <li>साइट में कोई <b>तकनीकी गड़बड़ी</b>।</li>
        </ul>

        <h3>शिकायत फ़ॉर्म</h3>
        <form id="grForm" autocomplete="off">
          <div class="form-grid">
            <div class="field">
              <label for="grKind">शिकायत का प्रकार</label>
              <select id="grKind">
                <option value="content">चुनाव / कंटेंट में गलत जानकारी</option>
                <option value="privacy">निजी जानकारी या नक़ल</option>
                <option value="technical">तकनीकी गड़बड़ी</option>
                <option value="other">कुछ और</option>
              </select>
            </div>
            <div class="field">
              <label for="grCode">चुनाव कोड <span class="hint">(अगर किसी चुनाव के बारे में है)</span></label>
              <input id="grCode" type="text" maxlength="10" value="${esc(eCode)}" placeholder="जैसे: 2P3ZYH" />
            </div>
            <div class="field">
              <label for="grName">आपका नाम</label>
              <input id="grName" type="text" maxlength="60" placeholder="आपका नाम" />
            </div>
            <div class="field">
              <label for="grContact">संपर्क <span class="hint">(फ़ोन या ईमेल — जवाब देने के लिए)</span></label>
              <input id="grContact" type="text" maxlength="80" placeholder="जैसे: 98xxxxxxxx" />
            </div>
            <div class="field full">
              <label for="grMsg">शिकायत <span class="req">*</span></label>
              <textarea id="grMsg" rows="5" maxlength="1000" placeholder="क्या गड़बड़ है, साफ़-साफ़ लिखिए…"></textarea>
              <span class="hint" id="grCount">0 / 1000</span>
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
            <button class="btn btn-primary" type="submit" id="grSend">शिकायत भेजें</button>
            <a class="btn btn-ghost" href="#/">होम पर जाएँ</a>
          </div>
          <p class="muted small" style="margin-top:12px">भेजने पर शिकायत सर्वर पर सुरक्षित दर्ज हो जाती है। कोई फ़र्ज़ी शिकायत नहीं बनती — असली ticket नंबर मिलेगा।</p>
        </form>
        <div id="grDone"></div>
      </div>
    </div>
  </section>`;

  const form = document.getElementById('grForm');
  const msg = document.getElementById('grMsg');
  const cnt = document.getElementById('grCount');
  if (msg && cnt) msg.addEventListener('input', () => { cnt.textContent = msg.value.length + ' / 1000'; });

  if (form) form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = (msg.value || '').trim();
    if (text.length < 5) return toast('कम से कम 5 अक्षर लिखें', 'err');
    const btn = document.getElementById('grSend');
    btn.disabled = true; btn.textContent = 'भेज रहे हैं…';
    try {
      const out = await api('/api/complaints', {
        method: 'POST',
        body: {
          kind: document.getElementById('grKind').value,
          electionCode: document.getElementById('grCode').value.trim(),
          name: document.getElementById('grName').value.trim(),
          contact: document.getElementById('grContact').value.trim(),
          message: text,
        },
      });
      form.style.display = 'none';
      const done = document.getElementById('grDone');
      if (done) done.innerHTML = `
        <div class="legal-warn" style="border-color:#28a745">
          ${ICON.shield}
          <div>
            <b>शिकायत दर्ज हो गई ✅</b><br>
            आपका ticket नंबर: <b style="letter-spacing:.06em">${esc(out.id)}</b><br>
            <span class="muted small">24 घंटे में पुष्टि, 15 दिन में हल — यही हमारा वादा है। ticket नंबर सँभाल कर रखें।</span>
          </div>
        </div>`;
      toast('शिकायत दर्ज हो गई — ticket ' + out.id, 'ok');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      btn.disabled = false; btn.textContent = 'शिकायत भेजें';
      toast(e.message || 'भेज नहीं पाए — फिर कोशिश करें', 'err');
    }
  });
}

function route() {
  const { parts } = parseHash();
  selectedCandidate = null;

  if (parts[0] === 'create') return safeRender('create', () => renderCreate());
  if (parts[0] === 'created' && parts[1]) return safeRender('created', () => renderCreated(parts[1].toUpperCase()));
  if (parts[0] === 'explore') return safeRender('explore', () => renderExplore());
  if (parts[0] === 'how') return safeRender('how', () => renderHow());
  if (parts[0] === 'login') return safeRender('login', () => renderLogin());
  if (parts[0] === 'disclaimer') return safeRender('disclaimer', () => renderDisclaimer());
  if (parts[0] === 'terms') return safeRender('terms', () => renderTerms());
  if (parts[0] === 'privacy') return safeRender('privacy', () => renderPrivacy());
  if (parts[0] === 'grievance') return safeRender('grievance', () => renderGrievance());
  if (parts[0] === 'developer') {
    if (!ownerGateAllowed()) return ownerGateHome();
    if (parts[1] === 'e' && parts[2]) return safeRender('developer', () => renderDevElection(parts[2].toUpperCase()));
    return safeRender('developer', () => renderDeveloper());
  }
  if (parts[0] === 'settings') return safeRender('settings', () => renderSettings(parts[1] || 'main'));
  if (parts[0] === 'e' && parts[1]) return safeRender('election', () => renderElection(parts[1].toUpperCase()));
  return safeRender('home', () => renderHome());
}

window.addEventListener('hashchange', () => {
  window.scrollTo({ top: 0 });
  /* पैनल से बाहर आ गए → लाइव फ़ीड (SSE) बंद करो */
  if (typeof stopDevLive === 'function' && !String(location.hash || '').startsWith('#/developer')) {
    try { stopDevLive(); } catch (_) {}
  }
  route();
  setTimeout(startGlobalTicker, 60);
});

function bindNavTheme() {
  const btn = document.getElementById('navTheme');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    setTheme(isDark ? 'light' : 'dark');
    toast(isDark ? 'लाइट मोड चालू' : 'डार्क मोड चालू', 'ok');
    if (state.route && state.route[0] === 'settings') render();
  });
}

/* =====================================================================
   ⏱️ ग्लोबल काउंटडाउन — हर पेज पर हर सेकंड अपने आप बदलता है
   (होम, खोजें, चुनाव पेज, मेरे चुनाव, डेवलपर पैनल — सब जगह)
   ===================================================================== */
let globalTickTimer = null;
function startGlobalTicker() {
  const scan = () => {
    $$('[data-left],[data-devleft],[data-count-to]').forEach((el) => {
      if (el.__jt) return;
      const ms = Number(el.dataset.left != null ? el.dataset.left
        : el.dataset.devleft != null ? el.dataset.devleft
        : el.dataset.countTo) || 0;
      el.__jt = { ms, at: Date.now() };
    });
  };
  const tick = () => {
    scan();
    $$('[data-left],[data-devleft],[data-count-to]').forEach((el) => {
      if (!el.__jt) return;
      const left = el.__jt.ms - (Date.now() - el.__jt.at);
      el.textContent = left > 0 ? fmtLeft(left) : 'समय पूरा';
    });
  };
  if (globalTickTimer) clearInterval(globalTickTimer);
  tick();
  globalTickTimer = setInterval(tick, 1000);
}

async function boot() {
  applyTheme();
  bindNavTheme();
  bindBrandOwnerGate();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSys = () => { if (getThemePref() === 'system') { applyTheme(); render(); } };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }
  renderNavAuth();
  await initDeviceId();
  await initFingerprint();
  await refreshMe();
  /* 🟢 इस फ़ोन से पहले लॉगिन हो चुका है? → अपने आप वही खाता */
  if (!state.token) {
    const auto = await tryAutoLogin();
    if (auto.ok && auto.user && !auto.already) {
      setTimeout(() => toast('स्वागत है, ' + auto.user.name + ' — आपका खाता पहचान लिया गया', 'ok'), 500);
    } else if (auto.hint && auto.hint.name) {
      savedNameHint = auto.hint.name;
      savedAccountHint = auto.hint;   /* सिर्फ़ छिपा username संकेत — अपने आप लॉगिन नहीं */
    }
  }
  renderNavAuth();
  route();
  startGlobalTicker();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
