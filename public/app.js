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
/* ek phone/computer = ek device. Fingerprint + localStorage, dono. */
let DEVICE_ID = null;
async function initDeviceId() {
  if (DEVICE_ID) return DEVICE_ID;
  let saved = store.get('jm_device');
  if (saved) { DEVICE_ID = saved; return DEVICE_ID; }
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
const API_BASE = String(window.JANMAT_API_BASE || '').replace(/\/+$/, '');
function apiUrl(path) { return API_BASE + path; }

async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = {};
  if (state.token) headers['x-user-token'] = state.token;
  if (state.devToken) headers['x-dev-token'] = state.devToken;
  if (DEVICE_ID) headers['x-device-id'] = DEVICE_ID;
  let body;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  // Ek hi baar server check hota hai (JanmatOffline.ensure). Static hosting
  // (GitHub Pages) ya file:// par seedha local preview mode chalta hai —
  // network par /api ke 404 ki barish nahi hoti.
  if (window.JanmatOffline && window.JanmatOffline.ensure) {
    let serverUp = true;
    try { serverUp = await window.JanmatOffline.ensure(); } catch (_) { serverUp = false; }
    if (!serverUp) return window.JanmatOffline.handle(path, Object.assign({}, opts, { headers }));
  }

  let res;
  try {
    res = await fetch(apiUrl(path), { method, headers, body });
  } catch (_) {
    if (window.JanmatOffline) return window.JanmatOffline.handle(path, Object.assign({}, opts, { headers }));
    throw new Error('सर्वर से कनेक्ट नहीं हो पाया। इंटरनेट जाँचें।');
  }
  let data = {};
  let parsed = false;
  try { data = await res.json(); parsed = true; } catch (_) {}
  if (!parsed && window.JanmatOffline) {
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

/* --------------------------- nav / auth -------------------------- */

function renderNavAuth() {
  const box = document.getElementById('navAuth');
  if (!box) return;
  if (state.user) {
    const initial = (state.user.name || '?').trim().charAt(0).toUpperCase();
    box.innerHTML = `
      <a class="user-chip" href="#/settings" title="सेटिंग्स">
        <span class="avatar">${esc(initial)}</span>
        <span class="user-chip-name">${esc(state.user.name)}</span>
      </a>`;
  } else {
    box.innerHTML = `<a class="btn btn-ghost btn-sm" href="#/login">लॉगिन करें</a>`;
  }
}

function setActiveNav(name) {
  $$('.nav-links a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
}

async function loginWithName(name) {
  const res = await api('/api/auth/login', { method: 'POST', body: { name, deviceId: DEVICE_ID } });
  state.user = res.user;
  state.token = res.token;
  state.quota = res.quota;
  store.set('jm_token', res.token);
  renderNavAuth();
  return res;
}

async function logoutUser() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  state.user = null;
  state.token = null;
  state.quota = null;
  store.del('jm_token');
  renderNavAuth();
  toast('लॉगआउट हो गया', 'ok');
  location.hash = '#/';
}

async function refreshMe() {
  if (!state.token) { state.user = null; return null; }
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.quota = me.quota;
    renderNavAuth();
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
  const title = opts.title || 'वोट देने के लिए लॉगिन करें';
  const sub = opts.sub || 'सिर्फ़ अपना नाम लिखिए — कोई पासवर्ड, OTP या ईमेल नहीं।';
  return `
  <div class="panel login-card" id="inlineLogin">
    <div class="login-card-ico">${ICON.user}</div>
    <h3>${esc(title)}</h3>
    <p class="muted">${esc(sub)}</p>
    <form id="inlineLoginForm" autocomplete="off">
      <input id="inlineName" type="text" placeholder="आपका नाम (जैसे: रवि शर्मा)" maxlength="30" aria-label="आपका नाम" />
      <button class="btn btn-primary" type="submit" id="inlineLoginBtn">लॉगिन करें</button>
    </form>
    <p class="login-note">एक नाम = एक खाता। इसीलिए वही नाम दोबारा लिखें जिससे आप आगे भी लॉगिन करेंगे।</p>
    <p class="login-note thin">आगे बढ़ने पर आप <a href="#/disclaimer">डिस्क्लेमर व नियम</a> स्वीकार करते हैं।</p>
  </div>`;
}

function bindLoginCard(onDone) {
  const form = document.getElementById('inlineLoginForm');
  if (!form) return;
  const input = document.getElementById('inlineName');
  const btn = document.getElementById('inlineLoginBtn');
  input.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) return toast('कम से कम 2 अक्षरों का नाम लिखें', 'err');
    btn.disabled = true;
    btn.textContent = 'लॉगिन…';
    try {
      await loginWithName(name);
      toast('स्वागत है, ' + state.user.name + '!', 'ok');
      if (onDone) onDone();
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
      btn.textContent = 'लॉगिन करें';
    }
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
    </div>
    <div class="ecard-foot">
      <div class="ecard-votes">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg>
        <b>${fmt(e.totalVotes)}</b> वोट · ${e.candidateCount} उम्मीदवार
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
        <p>नाम से लॉगिन कीजिए, चुनाव बनाइए या किसी के चुनाव में वोट दीजिए — बाकी सब अपने आप।</p>
      </div>
    </div>
    <div class="how-grid">
      <div class="how-card">
        <div class="how-num">1</div>
        <h3>नाम से लॉगिन</h3>
        <p>सिर्फ़ अपना नाम लिखिए — कोई पासवर्ड/OTP नहीं। यही नाम आपकी पहचान बनता है (किसे सिर्फ़ डेवलपर देख सकता है)।</p>
      </div>
      <div class="how-card">
        <div class="how-num">2</div>
        <h3>चुनाव बनाइए / वोट दीजिए</h3>
        <p>प्रकार, गाँव, ज़िला और राज्य चुनकर अपना चुनाव बनाइए — या किसी भी सार्वजनिक चुनाव में अपना वोट दर्ज कीजिए।</p>
      </div>
      <div class="how-card">
        <div class="how-num">3</div>
        <h3>लाइव परिणाम</h3>
        <p>सभी को लाइव नतीजे, प्रतिशत और कौन आगे है — सब दिखता है। परिणाम स्थायी रूप से सुरक्षित रहते हैं।</p>
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
        और एक लिंक से दुनिया के किसी भी कोने से मतदान करवाइए। नाम से लॉगिन, एक डिवाइस से एक वोट, हर नतीजा लाइव।
      </p>
      <div class="hero-actions">
        <a class="btn btn-saffron btn-lg" href="#/create">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          अपना चुनाव बनाएँ
        </a>
        <a class="btn btn-ghost btn-lg" href="#/explore">चुनाव खोजें</a>
      </div>
      <div class="hero-trust">
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg> नाम से लॉगिन</span>
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg> लाइव परिणाम</span>
        <span><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg> एक डिवाइस, एक वोट</span>
      </div>
    </div>

    <div class="hero-visual" aria-hidden="true">
      <div class="floaty tl">
        <div class="floaty-ico"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#0fa968" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
        <div>वोट दर्ज हुआ<small>रामकिशन यादव</small></div>
      </div>
      <div class="ballot">
        <div class="ballot-head">
          <div class="ballot-title">सरपंच चुनाव · नीमगाँव</div>
          <span class="ballot-live"><i></i> LIVE</span>
        </div>
        <div class="ballot-row picked">
          <div class="ballot-sym" data-sym="diya"></div>
          <div class="ballot-info">
            <div class="ballot-name">रामकिशन यादव</div>
            <div class="ballot-party">निर्दलीय</div>
            <div class="ballot-bar"><i style="width:39%"></i></div>
          </div>
          <div class="ballot-check"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg></div>
        </div>
        <div class="ballot-row">
          <div class="ballot-sym" data-sym="sunflower"></div>
          <div class="ballot-info">
            <div class="ballot-name">सुनीता देवी</div>
            <div class="ballot-party">महिला मोर्चा</div>
            <div class="ballot-bar"><i style="width:31%"></i></div>
          </div>
          <div class="ballot-check"></div>
        </div>
        <div class="ballot-row">
          <div class="ballot-sym" data-sym="tractor"></div>
          <div class="ballot-info">
            <div class="ballot-name">मोहन लाल शर्मा</div>
            <div class="ballot-party">ग्राम विकास पार्टी</div>
            <div class="ballot-bar"><i style="width:19%"></i></div>
          </div>
          <div class="ballot-check"></div>
        </div>
        <div class="ballot-foot"><span>कुल 36 वोट</span><span>अलवर, राजस्थान</span></div>
      </div>
      <div class="floaty br">
        <div class="floaty-ico"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#c97a00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
        <div>नीमगाँव<small>अलवर · राजस्थान</small></div>
      </div>
    </div>
  </div>
</section>`;

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
        <a class="btn btn-ghost" href="#/developer">डेवलपर पैनल</a>
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
      <li><b>सब वोट करेंगे</b> — एक डिवाइस = एक वोट, नतीजे लाइव</li>
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
  <div class="wrap stats-strip">
    <div class="stats-grid">
      <div class="stat"><b id="stElections">—</b><span>कुल चुनाव</span></div>
      <div class="stat"><b id="stVotes">—</b><span>पड़े हुए वोट</span></div>
      <div class="stat"><b id="stCands">—</b><span>उम्मीदवार</span></div>
      <div class="stat"><b id="stUsers">—</b><span>पंजीकृत मतदाता</span></div>
    </div>
  </div>

  <section class="section tight">
    <div class="wrap">
      <div class="section-head">
        <div>
          <div class="kicker">लाइव चुनाव</div>
          <h2>हाल में बने चुनाव</h2>
          <p>किसी भी चुनाव पर जाकर वोट कीजिए — या अपना नया चुनाव शुरू कीजिए।</p>
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
        <p>चुनाव बनाना बिलकुल मुफ़्त है — नाम से लॉगिन कीजिए और दो मिनट में चुनाव तैयार।</p>
        <a class="btn btn-saffron btn-lg" href="#/create">अभी चुनाव बनाएँ →</a>
        <p class="cta-legal">यह मंच सिर्फ़ सामुदायिक/निजी मतदान के लिए है। किसी सरकारी या निर्वाचन-आयोग चुनाव से इसका कोई संबंध नहीं है। <a href="#/disclaimer">पूरा डिस्क्लेमर</a></p>
      </div>
    </div>
  </section>`;

  fillSymbolSlots(app);
  bindOpenByCode();

  try {
    const [stats, list] = await Promise.all([api('/api/stats'), api('/api/elections')]);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fmt(v); };
    set('stElections', stats.elections);
    set('stVotes', stats.votes);
    set('stCands', stats.candidates);
    set('stUsers', stats.users);
    const box = document.getElementById('recentList');
    if (box) {
      box.innerHTML = list.elections.length
        ? list.elections.slice(0, 6).map(electionCard).join('')
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
      <p class="muted" style="margin:8px 0 24px;max-width:44em">गाँव, ज़िला, राज्य, चुनाव कोड या नाम से खोजिए और वोट कीजिए।</p>

      <div class="filters">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="q" type="search" placeholder="जैसे: नीमगाँव, अलवर, सरपंच…" autocomplete="off" />
        </div>
        <select id="stateFilter" aria-label="राज्य चुनें"><option value="">सभी राज्य</option></select>
        <select id="sortBy" aria-label="क्रम">
          <option value="new">नए पहले</option>
          <option value="votes">ज़्यादा वोट पहले</option>
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
      if (sort === 'votes') items.sort((a, b) => b.totalVotes - a.totalVotes);
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
    document.getElementById('emptyBox').innerHTML = `<div class="empty"><div class="em-ico">${ICON.warn}</div><h3>लोड नहीं हो पाया</h3><p>${esc(e.message)}</p></div>`;
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

        <div class="form-actions">
          <button class="btn btn-primary btn-lg" type="submit" id="submitBtn">चुनाव बनाएँ →</button>
          <span class="req-note">${esc(state.user.name)} के नाम से बनेगा · बिलकुल मुफ़्त</span>
        </div>
        <div class="field-error" id="formError" style="margin-top:12px"></div>
      </form>
      <div class="legal-strip">${ICON.shield}<span>यह मंच किसी सरकारी/निर्वाचन-आयोग चुनाव के लिए नहीं है — <a href="#/disclaimer">डिस्क्लेमर पढ़ें</a>।</span></div>
    </div>
  </section>`;

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
        body: { type, title, gram, district, state: st, candidates },
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

        <div class="status-banner info" style="margin-top:20px;text-align:left">
          <div class="sb-ico">${ICON.info || ''}${ICON.shield}</div>
          <div>
            <h4>अपने चुनाव का नियंत्रण आपके पास है</h4>
            <p>सेटिंग्स → “मेरे चुनाव” में जाकर आप कभी भी मतदान बंद करके विजेता की घोषणा कर सकते हैं (या दोबारा खोल सकते हैं)।</p>
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
function clearPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  closeLive();
}

function resultsHTML(d) {
  const r = d.results;
  const total = r.totalVotes;
  const maxVotes = Math.max(1, ...r.candidates.map((c) => c.votes));
  const rows = r.candidates.map((c, i) => {
    const isWinner = r.winnerIds.includes(c.id);
    const isLeader = !d.closed && total > 0 && c.votes === maxVotes && c.votes > 0;
    const pct = total ? (c.votes / total) * 100 : 0;
    return `
    <div class="res-row ${isWinner ? 'win' : ''}">
      <div class="res-top">
        <div class="res-sym">${symbolSVG(c.symbol, 22)}</div>
        <div style="min-width:0">
          <div class="res-name">${esc(c.name)}
            ${isWinner ? '<span class="crown" title="विजेता">👑</span>' : ''}
            ${isLeader ? '<span class="badge" style="font-size:10px;padding:2px 8px">आगे</span>' : ''}
          </div>
          <div class="res-party">${c.party ? esc(c.party) : 'निर्दलीय'}</div>
        </div>
        <div class="res-num"><b>${fmt(c.votes)}</b><span>${c.percent}%</span></div>
      </div>
      <div class="res-track"><div class="res-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="res-foot"><span>क्रम #${i + 1}</span><span>${fmt(c.votes)} / ${fmt(total)} वोट</span></div>
    </div>`;
  }).join('');

  let banner = '';
  if (d.closed) {
    if (r.tie) {
      banner = `<div class="winner-card"><div class="trophy">${ICON.handshake}</div><div>
        <h4>अंतिम परिणाम</h4><div class="wname">बराबरी का चुनाव</div>
        <div class="wsub">${r.candidates.filter((c) => c.votes === maxVotes).map((c) => esc(c.name)).join(' और ')} — दोनों को बराबर वोट</div></div></div>`;
    } else if (r.winnerIds.length) {
      const w = r.candidates.find((c) => c.id === r.winnerIds[0]);
      banner = `<div class="winner-card"><div class="trophy">${ICON.trophy}</div><div>
        <h4>विजेता की घोषणा</h4>
        <div class="wname" style="display:flex;align-items:center;gap:9px">${symbolSVG(w.symbol, 26)} ${esc(w.name)}</div>
        <div class="wsub">${w.party ? esc(w.party) + ' · ' : ''}${fmt(w.votes)} वोट · ${w.percent}% हिस्सा</div></div></div>`;
    } else {
      banner = `<div class="status-banner warn"><div class="sb-ico">${ICON.warn}</div><div><h4>कोई वोट नहीं पड़ा</h4><p>इस चुनाव में एक भी वोट दर्ज नहीं हुआ।</p></div></div>`;
    }
  }

  return `
    ${banner}
    <div class="total-strip">
      <div class="ts-item"><b>${fmt(total)}</b><span>कुल वोट</span></div>
      <div class="divider"></div>
      <div class="ts-item"><b>${d.candidates.length}</b><span>उम्मीदवार</span></div>
      <div class="divider"></div>
      <div class="ts-item"><b>${d.closed ? 'घोषित' : 'चालू'}</b><span>स्थिति</span></div>
      <div class="divider"></div>
      <div class="ts-item" style="margin-left:auto"><span class="live-note" id="liveNote">${d.closed ? 'परिणाम स्थायी रूप से सुरक्षित' : 'लाइव जुड़ रहे हैं…'}</span></div>
    </div>
    <div class="results">${rows}</div>`;
}

function voteAreaHTML(d) {
  if (d.closed) {
    return `<div class="status-banner warn"><div class="sb-ico">${ICON.lock}</div>
      <div><h4>यह चुनाव समाप्त हो चुका है</h4><p>अब नए वोट दर्ज नहीं हो सकते। नीचे अंतिम परिणाम देखिए।</p></div></div>`;
  }
  if (!state.user) {
    return loginCardHTML({ title: 'वोट देने के लिए लॉगिन करें', sub: 'सिर्फ़ अपना नाम लिखिए — कोई पासवर्ड या OTP नहीं।' });
  }
  if (d.hasVoted) {
    const my = d.candidates.find((c) => c.id === d.myVote);
    return `<div class="status-banner ok">
      <div class="sb-ico"><div class="tick-circle" style="width:34px;height:34px;margin:0;box-shadow:none;animation:none">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>
      </div></div>
      <div><h4>आपका वोट दर्ज हो चुका है</h4>
      <p>${my ? `आपने <b>${esc(my.name)}</b> को वोट दिया।` : 'इस चुनाव में आपका वोट दर्ज है।'} धन्यवाद!</p></div></div>`;
  }
  return `
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
    <p class="vote-hint">${ICON.shield} आपका नाम और वोट किसी को नहीं दिखता — सिर्फ़ आप और डेवलपर देख सकते हैं। एक डिवाइस से एक ही वोट।</p>`;
}

function electionHTML(d) {
  const link = shareUrl(d.code);
  const waText = encodeURIComponent(`🗳️ *${d.title}*\n📍 ${d.gram}, ${d.district}, ${d.state}\n\nअपना वोट डालें: ${link}`);
  const statusBadge = d.closed
    ? '<span class="badge closed">चुनाव समाप्त</span>'
    : '<span class="badge live"><i></i> मतदान चल रहा है</span>';

  const adminBox = d.canManage ? `
    <div class="panel admin-box">
      <div class="admin-row">
        <div>
          <h4 style="display:flex;align-items:center;gap:7px">${ICON.key} आयोजक नियंत्रण</h4>
          <p>${d.closed ? 'चुनाव बंद है — आप इसे दोबारा खोल सकते हैं।' : 'चुनाव बंद करते ही विजेता की घोषणा हो जाएगी और वोटिंग रुक जाएगी।'}</p>
        </div>
        <button class="btn ${d.closed ? 'btn-ghost' : 'btn-danger'}" id="toggleClose">${d.closed ? 'चुनाव फिर खोलें' : 'चुनाव समाप्त करें'}</button>
      </div>
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
        <span>${ICON.ballot} <b id="headVotes">${fmt(d.totalVotes)}</b> वोट पड़े</span>
        <span>${ICON.clock} ${timeAgo(d.createdAt)}</span>
        <span class="code-pill">कोड: <b>${esc(d.code)}</b></span>
      </div>
      <div class="ehead-actions">
        <button class="btn btn-saffron btn-sm" data-copy="${esc(link)}">${ICON.link} लिंक कॉपी करें</button>
        <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${waText}">WhatsApp पर शेयर</a>
        <a class="btn btn-ghost btn-sm" href="#/explore">सारे चुनाव</a>
      </div>
    </div>
  </section>

  <section class="content">
    <div class="wrap wrap-narrow">
      <div class="section-title">
        <h2>${d.closed ? 'अंतिम परिणाम' : d.hasVoted ? 'आपका वोट' : 'अपना वोट डालिए'}</h2>
        ${d.closed ? '' : '<span class="badge live"><i></i> लाइव</span>'}
      </div>
      <div id="voteArea">${voteAreaHTML(d)}</div>

      <div style="margin-top:34px">
        <div class="section-title">
          <h2>परिणाम</h2>
          <span class="badge live"><i id="liveDot"></i> <span id="liveLabel">लाइव</span></span>
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
    const noteText = () => (noteMode === 'live' ? 'लाइव अपडेट · बिना रीलोड' : 'हर 6 सेकंड में अपडेट');
    const setNote = (txt) => {
      const n = document.getElementById('liveNote');
      if (n) n.textContent = txt;
    };
    const paint = (fresh) => {
      const box = document.getElementById('resultsBox');
      if (box) box.innerHTML = resultsHTML(fresh);
      // resultsBox ke andar hi liveNote hai — dobara set karo
      setNote(noteText());
      const hv = document.getElementById('headVotes');
      if (hv) hv.textContent = fmt(fresh.totalVotes);
      const liveDot = document.getElementById('liveDot');
      if (liveDot) liveDot.classList.add('on');
    };
    const pollOnce = async () => {
      try { paint(await api('/api/elections/' + encodeURIComponent(d.code))); } catch (_) {}
    };
    const started = subscribeElection(d.code, {
      onUpdate: paint,
      poll: pollOnce,
      onStatus: (st) => {
        noteMode = st === 'live' ? 'live' : 'poll';
        const lbl = document.getElementById('liveLabel');
        if (lbl) lbl.textContent = st === 'live' ? 'लाइव' : 'फिर जुड़ रहे हैं…';
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
        if (lbl0) lbl0.textContent = 'लोकल';
      }
    }
    setNote(noteText());
  }
}

function bindElectionPage(d) {
  bindLoginCard(() => renderElection(d.code, { refresh: true }));

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
}

/* =====================================================================
   LOGIN PAGE
   ===================================================================== */

function renderLogin() {
  setActiveNav('');
  clearPoll();
  const next = new URLSearchParams(location.hash.split('?')[1] || '').get('next') || '';
  if (state.user) {
    app.innerHTML = `
    <section class="section"><div class="wrap wrap-narrow">
      <div class="panel login-done">
        <div class="avatar big">${esc((state.user.name || '?').charAt(0).toUpperCase())}</div>
        <h2>आप पहले से लॉगिन हैं</h2>
        <p class="muted">${esc(state.user.name)} के रूप में।</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px">
          <a class="btn btn-primary" href="${next ? '#/' + next : '#/settings'}">आगे बढ़ें</a>
          <button class="btn btn-ghost" id="switchUser">दूसरे नाम से लॉगिन</button>
        </div>
      </div>
    </div></section>`;
    document.getElementById('switchUser').addEventListener('click', async () => {
      await logoutUser();
    });
    return;
  }

  app.innerHTML = `
  <section class="login-page">
    <div class="wrap wrap-narrow">
      <div class="login-hero">
        <div class="kicker" style="color:#ffd08a">लॉगिन</div>
        <h1>अपना नाम लिखिए, बस।</h1>
        <p>कोई पासवर्ड नहीं, कोई OTP नहीं, कोई ईमेल नहीं — सिर्फ़ नाम।</p>
      </div>

      <div class="panel login-card big">
        <div class="login-card-ico">${ICON.user}</div>
        <h3>नाम से लॉगिन</h3>
        <p class="muted">यही नाम आपकी पहचान है — चुनाव बनाने और वोट देने दोनों में।</p>
        <form id="loginForm" autocomplete="off">
          <input id="loginName" type="text" placeholder="आपका नाम (जैसे: रवि शर्मा)" maxlength="30" aria-label="आपका नाम" />
          <button class="btn btn-primary btn-lg" type="submit" id="loginBtn">लॉगिन करें</button>
        </form>
        <div class="login-rules">
          <div>${ICON.shield}<span><b>नाम से लॉगिन:</b> जो नाम आपने डाला, आगे भी वही डालें — तभी आपका खाता वही रहेगा।</span></div>
          <div>${ICON.ballot}<span><b>एक डिवाइस, एक वोट:</b> हर चुनाव में आपका एक ही वोट गिना जाएगा।</span></div>
          <div>${ICON.clock}<span><b>रोज़ 2 चुनाव:</b> हर उपयोगकर्ता 1 दिन में अधिकतम 2 चुनाव बना सकता है।</span></div>
        </div>
        <p class="login-note">आगे बढ़ने पर आप <a href="#/disclaimer">डिस्क्लेमर व नियम</a> स्वीकार करते हैं।</p>
      </div>
    </div>
  </section>`;

  const form = document.getElementById('loginForm');
  const input = document.getElementById('loginName');
  const btn = document.getElementById('loginBtn');
  input.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = input.value.trim();
    if (name.length < 2) return toast('कम से कम 2 अक्षरों का नाम लिखें', 'err');
    btn.disabled = true;
    btn.textContent = 'लॉगिन…';
    try {
      const res = await loginWithName(name);
      toast('स्वागत है, ' + res.user.name + '!', 'ok');
      location.hash = next ? '#/' + next : '#/settings';
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
      btn.textContent = 'लॉगिन करें';
    }
  });
}

/* =====================================================================
   SETTINGS  (profile + my elections + my votes + developer entry)
   ===================================================================== */

const SETTINGS_ROWS = [
  { id: 'profile',    icon: 'user',    title: 'मेरी प्रोफ़ाइल',        sub: 'नाम, जुड़ने की तारीख़ और आँकड़े', href: '#/settings/profile' },
  { id: 'elections',  icon: 'ballot',  title: 'मेरे चुनाव',            sub: 'आपके बनाए चुनाव — चालू / समाप्त, बंद करें', href: '#/settings/elections' },
  { id: 'votes',      icon: 'star',    title: 'मेरे वोट',              sub: 'आपने किन चुनावों में किसको वोट दिया', href: '#/settings/votes' },
  { id: 'appearance', icon: 'gear',    title: 'दिखावट और डार्क मोड',   sub: 'लाइट, डार्क या सिस्टम थीम', href: '#/settings/appearance' },
  { id: 'guide',      icon: 'book',    title: 'गाइड — कैसे काम करता है', sub: 'बनाना, शेयर करना, वोट डालना और परिणाम', href: '#/how' },
  { id: 'privacy',    icon: 'shield',  title: 'गोपनीयता नीति',        sub: 'आपका डेटा क्या जाता है, कहाँ रहता है', href: '#/privacy' },
  { id: 'terms',      icon: 'doc',     title: 'नियम व शर्तें',         sub: 'उपयोग की शर्तें और ज़िम्मेदारियाँ', href: '#/terms' },
  { id: 'disclaimer', icon: 'warn',    title: 'डिस्क्लेमर',            sub: 'यह सरकारी/निर्वाचन-आयोग मंच नहीं है', href: '#/disclaimer' },
  { id: 'developer',  icon: 'key',     title: 'डेवलपर एक्सेस',         sub: 'सिर्फ़ आपके लिए — पासवर्ड से खुलेगा', href: '#/developer' },
  { id: 'account',    icon: 'lock',    title: 'खाता और सुरक्षा',       sub: 'लॉगआउट, खाता हटाना और डेटा', href: '#/settings/account' },
];

function rowIcon(name, size) {
  const svg = ICON[name] || ICON.gear;
  const px = size || 20;
  return svg.replace(/width="\d+"/, 'width="' + px + '"').replace(/height="\d+"/, 'height="' + px + '"');
}

function settingsRowHTML(r) {
  const badge = r.id === 'developer' ? '<span class="row-tag">तेज़</span>' : '';
  return `
  <a class="set-row" href="${r.href}">
    <span class="set-row-ico">${rowIcon(r.icon, 20)}</span>
    <span class="set-row-text">
      <b>${r.title}${badge}</b>
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
      <p class="muted" style="margin:9px 0 22px">अपने चुनाव, अपने वोट, डार्क मोड और डेवलपर एक्सेस देखने के लिए लॉगिन करें।</p>
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
          <p class="muted">${data ? esc(data.elections.length) + ' चुनाव · ' + esc(data.votes.length) + ' वोट' : 'सेटिंग्स'} · ${getThemePref() === 'dark' ? 'डार्क मोड' : getThemePref() === 'light' ? 'लाइट मोड' : 'सिस्टम थीम'}</p>
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
      <li><b>लाइव अपडेट</b><span>चालू — चुनाव पेज पर तुरंत अपडेट</span></li>
      <li><b>फ़ॉन्ट साइज़</b><span>साइट के साथ (मोबाइल-फ्रेंडली)</span></li>
    </ul>
  </div>`;
}

function settingsAccountHTML() {
  return `
  <div class="panel">
    <div class="section-title"><h2 style="font-size:18px">खाता</h2></div>
    <ul class="info-list">
      <li><b>लॉगिन का तरीक़ा</b><span>सिर्फ़ नाम (कोई पासवर्ड नहीं)</span></li>
      <li><b>नाम</b><span>${esc(state.user.name)}</span></li>
      <li><b>सदस्यता</b><span>${esc(fullDate(state.user.createdAt))}</span></li>
    </ul>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
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
        <li><b>लॉगिन</b><span>नाम से (कोई पासवर्ड नहीं)</span></li>
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
          <p class="my-leading">${lead && lead.votes ? `आगे: <b>${esc(lead.name)}</b> — ${fmt(lead.votes)} वोट (${lead.percent}%)` : 'अभी कोई वोट नहीं पड़ा'}</p>
        </div>
        <div class="my-item-actions">
          <div class="my-votes"><b>${fmt(e.totalVotes)}</b><span>वोट</span></div>
          <a class="btn btn-ghost btn-sm" href="#/e/${e.code}">देखें</a>
          <button class="btn ${e.closed ? 'btn-ghost' : 'btn-danger'} btn-sm" data-manage="${e.code}" data-action="${e.closed ? 'reopen' : 'close'}">${e.closed ? 'फिर खोलें' : 'समाप्त करें'}</button>
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
          <a class="btn btn-ghost btn-sm" href="#/e/${v.code}">परिणाम</a>
        </div>
      </div>`).join('')}
  </div>`;
}

/* =====================================================================
   DEVELOPER PANEL
   ===================================================================== */

let devData = null;
let devTab = 'summary';

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
          <button class="btn btn-ghost btn-sm" id="devLogout">डेवलपर लॉगआउट</button>
        </div>
      </div>

      <div class="dev-stats" id="devStats">${devStatsHTML()}</div>

      <div class="tabs dark">
        <button class="tab ${devTab === 'summary' ? 'active' : ''}" data-devt="summary">सारांश</button>
        <button class="tab ${devTab === 'users' ? 'active' : ''}" data-devt="users">यूज़र्स (${devData.users.length})</button>
        <button class="tab ${devTab === 'elections' ? 'active' : ''}" data-devt="elections">चुनाव (${devData.elections.length})</button>
        <button class="tab ${devTab === 'votes' ? 'active' : ''}" data-devt="votes">वोट विवरण (${devData.votes.length})</button>
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

  document.getElementById('devLogout').addEventListener('click', async () => {
    try { await api('/api/dev/logout', { method: 'POST' }); } catch (_) {}
    state.devToken = null;
    store.del('jm_dev_token');
    devData = null;
    renderDevLogin();
  });

  $$('[data-devt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      devTab = btn.dataset.devt;
      $$('[data-devt]').forEach((b) => b.classList.toggle('active', b === btn));
      document.getElementById('devBody').innerHTML = devBodyHTML();
      bindDevBody();
    });
  });

  bindDevBody();
  startDevLive();
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
  } catch (_) { return; }
  const st = document.getElementById('devStats');
  if (st) st.innerHTML = devStatsHTML();
  const body = document.getElementById('devBody');
  if (body) { body.innerHTML = devBodyHTML(); bindDevBody(); }
  const tabs = document.querySelectorAll('[data-devt]');
  if (tabs.length) {
    tabs[0].textContent = 'सारांश';
    tabs[1].textContent = 'यूज़र्स (' + devData.users.length + ')';
    tabs[2].textContent = 'चुनाव (' + devData.elections.length + ')';
    tabs[3].textContent = 'वोट विवरण (' + devData.votes.length + ')';
  }
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
  ['election-status', 'user-deleted'].forEach((evName) => {
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

function devBodyHTML() {
  if (!devData) return '';
  if (devTab === 'summary') return devSummaryHTML();
  if (devTab === 'users') return devUsersHTML();
  if (devTab === 'elections') return devElectionsHTML();
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
  <div class="dev-grid2">
    <div class="dev-card">
      <div class="dev-card-head"><h3>हाल के वोट</h3><button class="btn btn-ghost btn-sm" data-devt-jump="votes">सब देखें</button></div>
      <table class="dev-table">
        <thead><tr><th>समय</th><th>मतदाता</th><th>उम्मीदवार</th><th>चुनाव</th></tr></thead>
        <tbody>
          ${recentVotes.map((v) => `
            <tr>
              <td class="nowrap">${esc(timeAgo(v.at))}</td>
              <td><b>${esc(v.userName)}</b>${v.userIsDemo ? ' <span class="mini-badge">डेमो</span>' : ''}</td>
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
        <thead><tr><th>नाम</th><th>जुड़े</th><th>बनाए चुनाव</th><th>दिए वोट</th><th>डिवाइस</th><th>आख़िरी लॉगिन</th></tr></thead>
        <tbody>
          ${devData.users.map((u) => `
            <tr data-name="${esc(u.name.toLowerCase())}">
              <td><b>${esc(u.name)}</b>${u.isDemo ? ' <span class="mini-badge">डेमो</span>' : ''}</td>
              <td class="nowrap">${esc(timeAgo(u.createdAt))}</td>
              <td>${u.electionsCreated ? `<button class="chip-btn" data-user-elections="${esc(u.id)}">${u.electionsCreated}</button>` : '0'}</td>
              <td>${u.votesCast}</td>
              <td>${u.deviceCount}</td>
              <td class="nowrap">${esc(timeAgo(u.lastLoginAt))}</td>
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
            <tr data-name="${esc((v.userName + ' ' + v.candidateName + ' ' + v.electionCode + ' ' + v.electionTitle).toLowerCase())}">
              <td class="nowrap">${esc(fullDate(v.at))}</td>
              <td><b>${esc(v.userName)}</b>${v.userIsDemo ? ' <span class="mini-badge">डेमो</span>' : ''}</td>
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

function bindDevBody() {
  const jump = (tab) => {
    devTab = tab;
    $$('[data-devt]').forEach((b) => b.classList.toggle('active', b.dataset.devt === tab));
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
      const rows = [['नाम', 'जुड़े', 'बनाए चुनाव', 'दिए वोट', 'डिवाइस', 'डेमो']];
      devData.users.forEach((u) => rows.push([u.name, fullDate(u.createdAt), u.electionsCreated, u.votesCast, u.deviceCount, u.isDemo ? 'हाँ' : 'नहीं']));
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
      const rows = [['समय', 'मतदाता', 'चुनाव कोड', 'चुनाव शीर्षक', 'उम्मीदवार', 'पार्टी', 'डिवाइस']];
      devData.votes.forEach((v) => rows.push([fullDate(v.at), v.userName, v.electionCode, v.electionTitle, v.candidateName, v.candidateParty, v.deviceShort]));
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

  $$('[data-e-detail]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const d = await api('/api/dev/elections/' + btn.dataset.eDetail);
        const e = d.election;
        openDevModal(`
          <h3>${esc(e.title)}</h3>
          <p class="muted small">${esc(e.gram)} · ${esc(e.district)} · ${esc(e.state)} · बनाने वाला: <b class="creator-tag">${esc(e.creatorName)}</b> · ${e.closed ? 'समाप्त' : 'चालू'}</p>
          <div class="dev-mini-results">
            ${e.results.candidates.map((c) => `
              <div class="dev-mini-row">
                <span class="cand-cell">${symbolSVG(c.symbol, 16)} ${esc(c.name)}</span>
                <span class="muted small">${fmt(c.votes)} वोट · ${c.percent}%</span>
              </div>`).join('')}
          </div>
          <h4 style="margin:16px 0 8px">किसने किसको वोट दिया (${d.votes.length})</h4>
          <div class="table-wrap tall">
            <table class="dev-table"><thead><tr><th>समय</th><th>मतदाता</th><th>उम्मीदवार</th><th>डिवाइस</th></tr></thead><tbody>
              ${d.votes.map((v) => `<tr><td class="nowrap">${esc(fullDate(v.at))}</td><td><b>${esc(v.userName)}</b>${v.userIsDemo ? ' <span class="mini-badge">डेमो</span>' : ''}</td><td>${esc(v.candidateName)}</td><td class="muted small">${esc(v.deviceShort)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">कोई वोट नहीं</td></tr>'}
            </tbody></table>
          </div>`);
      } catch (e) { toast(e.message, 'err'); }
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
      devTab = 'summary';
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
          <div><h4>लॉगिन में पासवर्ड क्यों नहीं?</h4><p>यह मंच नाम-आधारित है — जैसा आपने चाहा। सिर्फ़ नाम लिखकर लॉगिन होता है। इसलिए अपना वही नाम दोबारा लिखें, वरना आपका खाता अलग बन जाएगा।</p></div>
          <div><h4>एक व्यक्ति कितनी बार वोट कर सकता है?</h4><p>हर चुनाव में आपका सिर्फ़ <b>एक वोट</b> गिना जाता है — आपके खाते से एक, और आपके डिवाइस से भी एक। दूसरे नाम से भी उसी डिवाइस से दोबारा वोट नहीं हो सकता।</p></div>
          <div><h4>एक दिन में कितने चुनाव बना सकते हैं?</h4><p>हर उपयोगकर्ता 1 दिन (IST) में अधिकतम <b>2 चुनाव</b> बना सकता है। सीमा आधी रात (IST) पर रीसेट होती है।</p></div>
          <div><h4>किसने किसको वोट दिया, कौन देख सकता है?</h4><p>सिर्फ़ <b>डेवलपर</b> (पासवर्ड से)। चुनाव बनाने वाला भी नहीं देख सकता कि किसने किसको वोट दिया — उसे भी सिर्फ़ गिनती दिखती है। सार्वजनिक रूप से सबको सिर्फ़ परिणाम दिखता है।</p></div>
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
          <li>लॉगिन सिर्फ़ नाम से है (कोई पासवर्ड/OTP नहीं)। इसलिए “एक नाम = एक खाता” — इसकी पुष्टि स्वयं उपयोगकर्ता की ज़िम्मेदारी है।</li>
        </ul>

        <h3>5. गोपनीयता व डेटा</h3>
        <ul>
          <li>सार्वजनिक रूप से सभी को सिर्फ़ <b>परिणाम</b> (किसको कितने वोट, कौन आगे) दिखता है।</li>
          <li>किसने किसको वोट दिया और किसने कौन-सा चुनाव बनाया — यह जानकारी <b>केवल डेवलपर</b> पासवर्ड से देख सकता है।</li>
          <li>तकनीकी रूप से डिवाइस-फिंगरप्रिंट व IP पता सीमा-नियंत्रण (एक डिवाइस एक वोट) के लिए संग्रहीत हो सकते हैं।</li>
          <li>डेटा सर्वर/डेटाबेस पर सुरक्षित रखा जाता है; कोई संवेदनशील जानकारी तीसरे पक्ष को नहीं बेची जाती।</li>
        </ul>

        <h3>6. सामग्री व गोपनीयता</h3>
        <p>उपयोगकर्ता जो नाम, पार्टी या जानकारी जोड़ता है उसकी ज़िम्मेदारी उसकी स्वयं की है। मंच संचालक किसी भी अपमानजनक/अवैध सामग्री को हटाने का अधिकार रखते हैं।</p>

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
        <p>साइट का उपयोग करने, नाम से लॉगिन करने, चुनाव बनाने या वोट देने का मतलब है कि आप इन शर्तों और <a href="#/privacy">गोपनीयता नीति</a> से सहमत हैं। यदि आप सहमत नहीं हैं तो कृपया साइट का उपयोग न करें।</p>

        <h3>2. पात्रता</h3>
        <ul>
          <li>आपको अपना <b>वास्तविक या स्थायी नाम</b> लिखना चाहिए (कोई पासवर्ड/OTP नहीं है, इसलिए नाम ही आपकी पहचान है)।</li>
          <li>किसी और का नाम लिखकर उसकी पहचान का दुरुपयोग करना मना है।</li>
          <li>18 वर्ष से कम आयु के उपयोगकर्ताओं को अभिभावक की सहमति से ही उपयोग करना चाहिए।</li>
        </ul>

        <h3>3. मंच का उद्देश्य</h3>
        <p>यह मंच केवल <b>सामुदायिक/निजी मतदान</b> के लिए है — जैसे गाँव, कॉलोनी, सोसाइटी, स्कूल, क्लब, संस्था या मित्र-मंडली के आंतरिक फ़ैसले। यह किसी भी सरकारी, विधायी, न्यायिक या संवैधानिक पद के चुनाव के लिए मान्य नहीं है।</p>

        <h3>4. मतदान नियम</h3>
        <ul>
          <li><b>एक डिवाइस = एक वोट</b> प्रति चुनाव। एक ही डिवाइस से दूसरे नाम लेकर भी दोबारा वोट नहीं हो सकता।</li>
          <li>हर उपयोगकर्ता <b>एक दिन (IST) में अधिकतम 2 चुनाव</b> बना सकता है।</li>
          <li>“एक नाम = एक खाता” — वही नाम दोबारा लिखने पर वही खाता खुलता है।</li>
          <li>आयोजक कभी भी अपना चुनाव बंद कर सकता है; बंद चुनाव में वोट नहीं पड़ सकते।</li>
        </ul>

        <h3>5. निषिद्ध गतिविधियाँ</h3>
        <ul>
          <li>साइट को हैक करना, बॉट/स्क्रिप्ट से वोट बढ़ाना या सिस्टम में बाधा डालना।</li>
          <li>अपमानजनक, सांप्रदायिक, धमकी भरा या अवैध नाम/सामग्री जोड़ना।</li>
          <li>किसी सरकारी चुनाव का प्रतिरूप बताकर भ्रम फैलाना।</li>
        </ul>
        <p>ऐसा करने पर खाता/चुनाव बिना सूचना हटाया जा सकता है।</p>

        <h3>6. सामग्री की ज़िम्मेदारी</h3>
        <p>उम्मीदवारों के नाम, पार्टी, चिन्ह और जानकारी आयोजक द्वारा भरी जाती है — उसकी सत्यता और अनुमति की ज़िम्मेदारी आयोजक की है। मंच केवल तकनीकी सुविधा देता है।</p>

        <h3>7. ज़िम्मेदारी की सीमा</h3>
        <p>मंच “जैसा है” (as-is) और “जैसा उपलब्ध है” के आधार पर दिया गया है। किसी भी प्रकार के नुकसान, विवाद, डेटा हानि, तकनीकी रुकावट, गलत परिणाम या इस साइट के उपयोग से होने वाली किसी भी हानि के लिए संचालक <b>उत्तरदायी नहीं</b> होंगे। उपयोग अपने जोखिम पर करें।</p>

        <h3>8. बदलाव</h3>
        <p>ये शर्तें कभी भी अपडेट हो सकती हैं। जारी रखने का मतलब है नए नियमों की स्वीकृति।</p>

        <div class="legal-foot">
          <p><b>संपर्क:</b> साइट के संचालक (डेवलपर) से <a href="#/developer">डेवलपर पेज</a> के माध्यम से संपर्क किया जा सकता है।</p>
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
          <li><b>टोकन</b> — आपके लॉगिन को याद रखने के लिए एक तकनीकी कोड (आपके ब्राउज़र में सुरक्षित)।</li>
          <li><b>डिवाइस पहचान</b> — “एक डिवाइस = एक वोट” लागू करने के लिए डिवाइस फिंगरप्रिंट का हैश (बिना कच्चे डेटा के)।</li>
          <li><b>IP पता और ब्राउज़र जानकारी</b> — सिर्फ़ दुरुपयोग रोकने और सीमा लागू करने के लिए (सर्वर लॉग में)।</li>
          <li><b>वोट</b> — आपने किस चुनाव में किसको वोट दिया (गिनती और परिणाम के लिए)।</li>
          <li><b>आपके बनाए चुनाव</b> — शीर्षक, गाँव/ज़िला/राज्य, उम्मीदवार।</li>
        </ul>

        <h3>2. डेटा किसको दिखता है</h3>
        <ul>
          <li><b>सबको (सार्वजनिक):</b> चुनाव का नाम, जगह, उम्मीदवार, कुल वोट, प्रतिशत और कौन आगे है।</li>
          <li><b>आयोजक को:</b> अपने चुनाव की गिनती और “बंद करें” का अधिकार। वह भी <b>नहीं</b> देख सकता कि किसने किसको वोट दिया।</li>
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
        <p>हम विज्ञापन कुकीज़ या थर्ड-पार्टी ट्रैकर नहीं लगाते। सिर्फ़ आपकी पसंद (थीम, लॉगिन) ब्राउज़र के localStorage में रहती है, जिसे आप कभी भी ब्राउज़र डेटा साफ़ करके मिटा सकते हैं।</p>

        <h3>8. बच्चे</h3>
        <p>यह मंच 13 वर्ष से कम बच्चों के लिए नहीं बनाया गया; अभिभावक की सहमति के बिना उपयोग न करें।</p>

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

function route() {
  const { parts } = parseHash();
  selectedCandidate = null;

  if (parts[0] === 'create') return renderCreate();
  if (parts[0] === 'created' && parts[1]) return renderCreated(parts[1].toUpperCase());
  if (parts[0] === 'explore') return renderExplore();
  if (parts[0] === 'how') return renderHow();
  if (parts[0] === 'login') return renderLogin();
  if (parts[0] === 'disclaimer') return renderDisclaimer();
  if (parts[0] === 'terms') return renderTerms();
  if (parts[0] === 'privacy') return renderPrivacy();
  if (parts[0] === 'developer') return renderDeveloper();
  if (parts[0] === 'settings') return renderSettings(parts[1] || 'main');
  if (parts[0] === 'e' && parts[1]) return renderElection(parts[1].toUpperCase());
  return renderHome();
}

window.addEventListener('hashchange', () => { window.scrollTo({ top: 0 }); route(); });

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

async function boot() {
  applyTheme();
  bindNavTheme();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSys = () => { if (getThemePref() === 'system') { applyTheme(); render(); } };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }
  renderNavAuth();
  await initDeviceId();
  await refreshMe();
  renderNavAuth();
  route();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
