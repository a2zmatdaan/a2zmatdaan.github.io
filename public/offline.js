/* =====================================================================
   जनमत — प्रीव्यू / ऑफ़लाइन मोड (v2)
   ---------------------------------------------------------------------
   Jab server available na ho (jaise file preview / static hosting), tab
   bhi site poori chale. Data usi browser me (localStorage) rehta hai.
   API shapes bilkul server v2 jaise hain — isliye UI code same chalta hai.

   ⚠️ Yeh sirf preview hai: asli multi-user voting ke liye `node server.js`.
   ===================================================================== */
(function () {
  'use strict';

  var DB_KEY = 'jm_offline_db_v2';
  var PREVIEW_DEV_PASS = 'PREVIEW-ONLY'; /* sirf local preview ke liye */
  var DAILY_LIMIT = 2;
  var db = null;

  /* ------------------------------ utils ---------------------------- */
  function rid(n) {
    var s = '';
    var a = 'abcdef0123456789';
    for (var i = 0; i < (n || 16); i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }
  function clean(str, max) {
    return String(str == null ? '' : str).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max || 120);
  }
  function nameKey(n) { return clean(n, 40).toLowerCase(); }
  function istDay(ts) {
    var d = new Date(Number(ts || Date.now()) + 5.5 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function nextMidnight(ts) {
    var d = new Date(Number(ts || Date.now()) + 5.5 * 3600 * 1000);
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime() - 5.5 * 3600 * 1000;
  }
  var CODE_A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newCode() {
    var c;
    do {
      c = '';
      for (var i = 0; i < 6; i++) c += CODE_A[Math.floor(Math.random() * CODE_A.length)];
    } while (db.elections.some(function (e) { return e.code === c; }));
    return c;
  }
  function err(message, status, code, extra) {
    var e = new Error(message);
    e.status = status || 400;
    if (code) e.code = code;
    if (extra) e.data = extra;
    return e;
  }

  /* ------------------------------ seed ----------------------------- */
  /* koi demo/fake data nahi — bilkul khali DB. Jo user khud banayega, wahi dikhega. */
  function seed() {
    return { version: 3, createdAt: Date.now(), users: [], elections: [], devSessions: {}, deviceOwner: {}, fpOwner: {}, deviceAccounts: {}, fpAccounts: {}, accountApplications: [] };
  }
  function migrateOfflineDb() {
    if (!db || typeof db !== 'object') return;
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.elections)) db.elections = [];
    if (!db.devSessions || typeof db.devSessions !== 'object') db.devSessions = {};
    if (!db.deviceOwner || typeof db.deviceOwner !== 'object') db.deviceOwner = {};
    if (!db.fpOwner || typeof db.fpOwner !== 'object') db.fpOwner = {};
    if (!db.deviceAccounts || typeof db.deviceAccounts !== 'object') db.deviceAccounts = {};
    if (!db.fpAccounts || typeof db.fpAccounts !== 'object') db.fpAccounts = {};
    if (!Array.isArray(db.accountApplications)) db.accountApplications = [];
    db.users.forEach(function (u) {
      if (!u || typeof u !== 'object') return;
      if (typeof u.username !== 'string') u.username = u.username ? String(u.username) : null;
      if (!u.accountStatus) u.accountStatus = u.deletedAt ? 'deleted' : 'active';
      if (u.deletedAt) u.accountStatus = 'deleted';
      if (['active', 'replaced', 'deleted', 'banned'].indexOf(u.accountStatus) === -1) u.accountStatus = 'active';
      if (!Array.isArray(u.moderationHistory)) u.moderationHistory = [];
      if (!u.devices || typeof u.devices !== 'object') u.devices = {};
      if (!u.tokens || typeof u.tokens !== 'object') u.tokens = {};
      Object.keys(u.devices).forEach(function (dk) {
        if (!Array.isArray(db.deviceAccounts[dk])) db.deviceAccounts[dk] = [];
        if (db.deviceAccounts[dk].indexOf(u.id) === -1) db.deviceAccounts[dk].push(u.id);
      });
    });
    Object.keys(db.deviceOwner).forEach(function (dk) {
      var uid = db.deviceOwner[dk];
      if (!Array.isArray(db.deviceAccounts[dk])) db.deviceAccounts[dk] = [];
      if (uid && db.deviceAccounts[dk].indexOf(uid) === -1) db.deviceAccounts[dk].push(uid);
    });
    Object.keys(db.fpOwner).forEach(function (fk) {
      var uid = db.fpOwner[fk];
      if (!Array.isArray(db.fpAccounts[fk])) db.fpAccounts[fk] = [];
      if (uid && db.fpAccounts[fk].indexOf(uid) === -1) db.fpAccounts[fk].push(uid);
    });
  }

  /* ---------------------------- storage ---------------------------- */
  function load() {
    if (db) return;
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 3) { db = parsed; migrateOfflineDb(); return; }
      }
    } catch (e) {}
    db = seed();
    save();
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {}
  }

  /* --------------------------- domain ------------------------------ */
  function tally(e) {
    var counts = {};
    e.candidates.forEach(function (c) { counts[c.id] = 0; });
    var total = 0;
    Object.keys(e.votes || {}).forEach(function (uid) {
      var v = e.votes[uid];
      if (v && counts[v.c] !== undefined) { counts[v.c]++; total++; }
    });
    var rows = e.candidates.map(function (c) {
      return {
        id: c.id, name: c.name, party: c.party || '', symbol: c.symbol || 'diya',
        votes: counts[c.id] || 0,
        percent: total ? Math.round((counts[c.id] || 0) / total * 1000) / 10 : 0
      };
    });
    rows.sort(function (a, b) { return b.votes - a.votes; });
    var top = rows.length ? rows[0].votes : 0;
    var leaders = rows.filter(function (r) { return r.votes === top && top > 0; });
    return {
      totalVotes: total, candidates: rows,
      winnerIds: e.closed && leaders.length ? leaders.map(function (l) { return l.id; }) : [],
      tie: e.closed && leaders.length > 1
    };
  }
  function publicResults(e) {
    var t = tally(e);
    if (e.closed) { t.resultsHidden = false; return t; }
    return {
      totalVotes: null, resultsHidden: true,
      candidates: e.candidates.map(function (c) {
        return {
          id: c.id, name: c.name, party: c.party || '', symbol: c.symbol || 'diya',
          votes: null, percent: null
        };
      }),
      winnerIds: [], tie: false
    };
  }
  function summary(e) {
    var t = tally(e);
    return {
      code: e.code, title: e.title, type: e.type, gram: e.gram, district: e.district, state: e.state,
      createdAt: e.createdAt, closed: !!e.closed, closedAt: e.closedAt || null, demo: !!e.isDemo,
      totalVotes: e.closed ? t.totalVotes : null, candidateCount: e.candidates.length,
      resultsHidden: !e.closed, resultsVisible: !!e.closed, resultsRevealAt: e.closed ? (e.closedAt || e.endsAt || null) : (e.endsAt || null),
      symbols: e.candidates.slice(0, 5).map(function (c) { return c.symbol || 'diya'; })
    };
  }
  function full(e, viewer) {
    var t = tally(e);
    var my = viewer && e.votes[viewer.id] ? e.votes[viewer.id].c : null;
    var out = summary(e);
    out.candidates = e.candidates.map(function (c) { return { id: c.id, name: c.name, party: c.party || '', symbol: c.symbol || 'diya' }; });
    out.results = publicResults(e);
    out.hasVoted = !!my;
    out.myVote = my;
    out.canManage = !!(viewer && e.creatorId === viewer.id);
    return out;
  }
  function quotaFor(u) {
    var today = istDay();
    var used = db.elections.filter(function (e) { return e.creatorId === u.id && istDay(e.createdAt) === today; }).length;
    return { limit: DAILY_LIMIT, used: used, remaining: Math.max(0, DAILY_LIMIT - used), resetsAt: nextMidnight() };
  }
  function pubUser(u) { return { id: u.id, name: u.name, username: u.username || null, accountStatus: u.accountStatus || 'active', createdAt: u.createdAt }; }
  function findElection(code) {
    var c = clean(code, 16).toUpperCase();
    for (var i = 0; i < db.elections.length; i++) if (db.elections[i].code === c) return db.elections[i];
    return null;
  }
  function hashPreview(secret, salt) {
    var s = String(salt || '') + '|' + String(secret || '');
    var h1 = 2166136261, h2 = 5381;
    for (var i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619); h2 = (Math.imul(h2, 33) ^ s.charCodeAt(i)) >>> 0; }
    return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  function setPreviewPassword(user, password) {
    var salt = rid(8);
    user.pwHash = salt + ':' + hashPreview(password, salt);
    var raw = '';
    for (var i = 0; i < 12; i++) raw += CODE_A[Math.floor(Math.random() * CODE_A.length)];
    var code = raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
    var rsalt = rid(8);
    user.recoveryHash = rsalt + ':' + hashPreview(raw, rsalt);
    return code;
  }
  function checkPreview(secret, stored) {
    var parts = String(stored || '').split(':');
    return parts.length === 2 && hashPreview(secret, parts[0]) === parts[1];
  }
  function normalizeUsername(raw) {
    return String(raw == null ? '' : raw).trim().toLowerCase().replace(/^@+/, '').replace(/\s+/g, '_');
  }
  function validateUsername(raw) {
    var u = normalizeUsername(raw);
    if (!u) return { error: 'अपना username चुनें — यही आपकी असली login-ID होगी।' };
    if (!/^[a-z][a-z0-9_]{2,19}$/.test(u)) return { error: 'Username 3–20 अक्षरों का रखें: शुरुआत अंग्रेज़ी अक्षर (a–z) से, फिर अक्षर, अंक या _ चलेंगे (जैसे pawan_verma)।' };
    if (u.indexOf('__') !== -1 || u.charAt(u.length - 1) === '_') return { error: 'Username में लगातार दो _ या अंत में _ न रखें।' };
    if (['developer','dev','admin','administrator','janmat','a2zjanmat','teamjanmat','janmat_team','moderator','root','support','help','official','election','vote','electioncommission','jansunwai','pawan_admin'].indexOf(u) !== -1) return { error: 'यह username आरक्षित है, कृपया दूसरा चुनें।' };
    return { username: u };
  }
  function validatePin(pin, username) {
    var s = String(pin == null ? '' : pin);
    if (!/^[0-9]{6,10}$/.test(s)) return { error: 'PIN सिर्फ़ 6 से 10 अंकों का रखें (सिर्फ़ नंबर 0–9)।' };
    if (/^([0-9])\1+$/.test(s)) return { error: 'PIN में सारे अंक एक जैसे न रखें — कुछ अलग चुनें।' };
    var asc = true, desc = true;
    for (var i = 1; i < s.length; i++) {
      var d = Number(s[i]) - Number(s[i - 1]);
      if (d !== 1) asc = false;
      if (d !== -1) desc = false;
    }
    if (asc || desc || ['123456','654321','1234567','12345678','123456789','1234567890','987654','9876543210','112233','121212','123123','111111','000000','102030','246810','135790','5201314'].indexOf(s) !== -1) return { error: 'यह PIN बहुत आम है (जैसे 123456) — कोई ऐसा नंबर चुनें जो सिर्फ़ आपको याद रहे।' };
    if (username && String(username).indexOf(s) !== -1) return { error: 'PIN अपने username जैसा न रखें।' };
    return { password: s };
  }
  function maskUsername(u) {
    var s = String(u || '');
    if (s.length <= 3) return s ? s.charAt(0) + '***' : null;
    return s.slice(0, 2) + '***' + s.slice(-2);
  }
  function formatBanDate(ts) {
    var n = Number(ts);
    if (!isFinite(n) || n <= 0) return '';
    try { return new Date(n).toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); }
    catch (_) { return new Date(n).toISOString(); }
  }
  function clearBanFields(user) {
    if (!user) return;
    user.banType = null; user.bannedAt = null; user.banUntil = null; user.banReason = ''; user.banBy = null;
  }
  function syncUserBan(user) {
    if (!user || typeof user !== 'object') return false;
    if (user.deletedAt && user.accountStatus !== 'deleted') {
      user.accountStatus = 'deleted'; clearBanFields(user); save(); return true;
    }
    if ((user.accountStatus || 'active') !== 'banned') return false;
    if (user.banType === 'temporary') {
      var until = Number(user.banUntil || 0);
      if (until && Date.now() >= until) {
        user.accountStatus = 'active'; user.banExpiredAt = Date.now(); clearBanFields(user); save(); return true;
      }
      if (!until) { user.banType = 'permanent'; save(); return true; }
    } else if (user.banType !== 'permanent') {
      user.banType = 'permanent'; save(); return true;
    }
    return false;
  }
  function moderationInfo(user) {
    syncUserBan(user);
    var status = user && user.deletedAt ? 'deleted' : ((user && user.accountStatus) || 'active');
    var banned = status === 'banned';
    return {
      accountStatus: status,
      deletedAt: user && user.deletedAt ? user.deletedAt : null,
      deletedBy: user && user.deletedBy ? user.deletedBy : null,
      deleteReason: user && user.deleteReason ? String(user.deleteReason).slice(0, 200) : '',
      banType: banned ? (user.banType || 'permanent') : null,
      bannedAt: banned ? (user.bannedAt || null) : null,
      banUntil: banned && user.banType === 'temporary' ? (Number(user.banUntil) || null) : null,
      banReason: banned && user.banReason ? String(user.banReason).slice(0, 200) : '',
      banBy: banned ? (user.banBy || null) : null
    };
  }
  function inactiveAccountError(user, context) {
    if (!user) return null;
    syncUserBan(user);
    if (isActiveUser(user)) return null;
    var info = moderationInfo(user);
    var doing = context === 'recover' ? 'PIN रिकवरी' : 'लॉगिन';
    var reasonText = info.banReason ? ' डेवलपर द्वारा दिया कारण: “' + info.banReason + '”।' : '';
    if (info.accountStatus === 'banned' && info.banType === 'temporary') {
      return err('कारण: इस खाते पर ' + formatBanDate(info.banUntil) + ' तक अस्थायी रोक लगी है, इसलिए ' + doing + ' नहीं होगा। अवधि पूरी होने पर खाता अपने आप फिर चालू हो जाएगा।' + reasonText + ' अगर रोक गलत लगी हो तो शिकायत पेज से पुनर्विचार माँगें।', 403, 'ACCOUNT_BANNED_TEMPORARY', { accountStatus: 'banned', banType: 'temporary', banUntil: info.banUntil });
    }
    if (info.accountStatus === 'banned') {
      return err('कारण: इस खाते पर स्थायी रोक लगी है, इसलिए ' + doing + ' नहीं होगा। Team Janmat द्वारा रोक हटाए जाने पर ही यह खाता फिर चालू होगा।' + reasonText + ' अगर रोक गलत लगी हो तो शिकायत पेज से पुनर्विचार माँगें।', 403, 'ACCOUNT_BANNED_PERMANENT', { accountStatus: 'banned', banType: 'permanent', banUntil: null });
    }
    if (info.accountStatus === 'deleted') {
      return err('कारण: यह खाता हटाया जा चुका है, इसलिए इससे ' + doing + ' नहीं होगा।', 401, 'ACCOUNT_DELETED', { accountStatus: 'deleted' });
    }
    return err(context === 'recover' ? 'कारण: यह खाता अब चालू नहीं है (शायद नए खाते से बदल चुका है)। अपने नए username से प्रयास करें।' : 'यह खाता अब चालू नहीं है। अगर आपका खाता नए username से जुड़ा था तो उससे लॉगिन करें।', 401, 'ACCOUNT_INACTIVE', { accountStatus: info.accountStatus });
  }
  function noteUserModeration(user, action, reason, banUntil, by) {
    if (!user) return;
    if (!Array.isArray(user.moderationHistory)) user.moderationHistory = [];
    user.moderationHistory.push({ action: action, at: Date.now(), by: by || 'developer', reason: String(reason || '').slice(0, 200), banUntil: banUntil ? Number(banUntil) : null });
    user.moderationHistory = user.moderationHistory.slice(-20);
  }
  function softDeleteAccount(user, by, reason) {
    var now = Date.now();
    user.deletedAt = now; user.deletedBy = by || 'developer'; user.deleteReason = String(reason || '').slice(0, 200);
    user.accountStatus = 'deleted'; clearBanFields(user);
    user.name = 'हटाया गया उपयोगकर्ता'; user.nameLower = 'deleted:' + user.id;
    user.pwHash = null; user.recoveryHash = null; user.tokens = {};
    var developerDelete = (by || 'developer') === 'developer';
    if (developerDelete) {
      if (!db.deviceAccounts || typeof db.deviceAccounts !== 'object') db.deviceAccounts = {};
      Object.keys(user.devices || {}).forEach(function (dk) {
        if (!Array.isArray(db.deviceAccounts[dk])) db.deviceAccounts[dk] = [];
        if (db.deviceAccounts[dk].indexOf(user.id) === -1) db.deviceAccounts[dk].push(user.id);
      });
    }
    user.devices = {}; user.lastLoginAt = now;
    if (!developerDelete) Object.keys(db.deviceOwner || {}).forEach(function (d) { if (db.deviceOwner[d] === user.id) delete db.deviceOwner[d]; });
    if (!developerDelete) Object.keys(db.fpOwner || {}).forEach(function (k) { if (db.fpOwner[k] === user.id) delete db.fpOwner[k]; });
    (developerDelete ? [] : [db.deviceAccounts, db.fpAccounts]).forEach(function (store) {
      if (!store || typeof store !== 'object') return;
      Object.keys(store).forEach(function (key) {
        if (!Array.isArray(store[key])) return;
        store[key] = store[key].filter(function (id) { return id !== user.id; });
        if (!store[key].length) delete store[key];
      });
    });
    return user;
  }
  function isActiveUser(u) { syncUserBan(u); return !!(u && !u.deletedAt && (u.accountStatus || 'active') === 'active'); }
  function findUserByUsername(username) {
    var u = normalizeUsername(username);
    if (!u) return null;
    for (var i = 0; i < db.users.length; i++) if (db.users[i].username && normalizeUsername(db.users[i].username) === u) return db.users[i];
    return null;
  }
  function previewHash(secret) {
    var salt = rid(8);
    return salt + ':' + hashPreview(secret, salt);
  }
  function makeRecovery() {
    var raw = '';
    for (var i = 0; i < 12; i++) raw += CODE_A[Math.floor(Math.random() * CODE_A.length)];
    return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
  }
  function syncApplications() {
    if (!Array.isArray(db.accountApplications)) db.accountApplications = [];
    var now = Date.now(); var changed = false;
    db.accountApplications.forEach(function (a) {
      if (a && a.status === 'pending' && a.expiresAt && now > a.expiresAt) { a.status = 'expired'; a.decidedAt = now; changed = true; }
    });
    if (changed) save();
  }
  function usernameTaken(username, exceptUserId) {
    var u = normalizeUsername(username);
    if (!u) return true;
    syncApplications();
    for (var i = 0; i < db.users.length; i++) {
      var x = db.users[i];
      if (x && x.username && normalizeUsername(x.username) === u && x.id !== exceptUserId) return true;
    }
    return db.accountApplications.some(function (a) { return a && a.status === 'pending' && a.desiredUsername === u; });
  }
  function usernameSuggestions(base) {
    var out = [];
    var root = normalizeUsername(base).replace(/[^a-z0-9_]/g, '').slice(0, 16) || 'user';
    for (var i = 1; i <= 99 && out.length < 3; i++) {
      var cand = (root + (i < 10 ? '0' + i : String(i))).slice(0, 20);
      if (validateUsername(cand).username && !usernameTaken(cand)) out.push(cand);
    }
    return out;
  }
  function recordDeviceAccount(user, deviceKey, fpKey) {
    if (!user || !deviceKey) return;
    if (!Array.isArray(db.deviceAccounts[deviceKey])) db.deviceAccounts[deviceKey] = [];
    if (db.deviceAccounts[deviceKey].indexOf(user.id) === -1) db.deviceAccounts[deviceKey].push(user.id);
    if (fpKey) {
      if (!Array.isArray(db.fpAccounts[fpKey])) db.fpAccounts[fpKey] = [];
      if (db.fpAccounts[fpKey].indexOf(user.id) === -1) db.fpAccounts[fpKey].push(user.id);
    }
  }
  function deviceConflictUsers(deviceKey, fpKey) {
    var ids = [];
    function add(v) {
      if (Array.isArray(v)) v.forEach(function (x) { if (x && ids.indexOf(x) === -1) ids.push(x); });
      else if (v && ids.indexOf(v) === -1) ids.push(v);
    }
    if (deviceKey) { add(db.deviceAccounts[deviceKey]); add(db.deviceOwner[deviceKey]); }
    if (fpKey) { add(db.fpAccounts[fpKey]); add(db.fpOwner[fpKey]); }
    db.users.forEach(function (u) { if (u && deviceKey && u.devices && u.devices[deviceKey] && ids.indexOf(u.id) === -1) ids.push(u.id); });
    return ids.map(function (id) { return findUserById(id); }).filter(function (u) {
      syncUserBan(u);
      var status = u && u.deletedAt ? 'deleted' : ((u && u.accountStatus) || 'active');
      return !!(u && (['active', 'banned'].indexOf(status) !== -1 || (status === 'deleted' && u.deletedBy === 'developer')));
    });
  }
  function adoptGuestVotes(user, deviceKey) {
    var key = 'g:' + deviceKey;
    var adopted = 0;
    db.elections.forEach(function (e) {
      var gv = e.votes && e.votes[key];
      if (!gv) return;
      var mine = e.votes[user.id];
      if (mine) {
        var guestOlder = (Number(gv.at) || 0) <= (Number(mine.at) || 0);
        var kept = guestOlder ? gv : mine;
        var dropped = guestOlder ? mine : gv;
        if (!Array.isArray(e.mergedVotes)) e.mergedVotes = [];
        e.mergedVotes.push({ at: Date.now(), userId: user.id, guestId: key, keptCandidate: kept.c || null, droppedCandidate: dropped.c || null, reason: 'guest+account same person' });
        delete e.votes[key];
        e.votes[user.id] = { c: kept.c, at: kept.at || Date.now(), device: kept.device || deviceKey, guest: false, via: guestOlder ? 'guest' : (mine.via || 'account'), sourceGuest: true, linkedName: user.name, linkedUsername: user.username || null, adoptedAt: Date.now() };
      } else {
        delete e.votes[key];
        e.votes[user.id] = { c: gv.c, at: gv.at || Date.now(), device: gv.device || deviceKey, guest: false, via: 'guest', sourceGuest: true, originalGuestId: key, linkedName: user.name, linkedUsername: user.username || null, adoptedAt: Date.now() };
      }
      if (e.devices && e.devices[deviceKey]) e.devices[deviceKey].userId = user.id;
      adopted++;
    });
    return adopted;
  }
  function mergeAccountInto(oldUser, newUser) {
    if (!oldUser || !newUser || oldUser.id === newUser.id) return;
    db.elections.forEach(function (e) {
      if (e.creatorId === oldUser.id) e.creatorId = newUser.id;
      var ov = e.votes && e.votes[oldUser.id];
      var nv = e.votes && e.votes[newUser.id];
      if (ov && !nv) { delete e.votes[oldUser.id]; var copy = {}; Object.keys(ov).forEach(function (k) { copy[k] = ov[k]; }); copy.mergedFrom = oldUser.id; e.votes[newUser.id] = copy; }
      else if (ov && nv) {
        var keepOld = (Number(ov.at) || 0) <= (Number(nv.at) || 0);
        if (!Array.isArray(e.mergedVotes)) e.mergedVotes = [];
        e.mergedVotes.push({ at: Date.now(), userId: newUser.id, fromUserId: oldUser.id, keptCandidate: (keepOld ? ov : nv).c || null, droppedCandidate: (keepOld ? nv : ov).c || null, reason: 'account replaced' });
        if (keepOld) { var c2 = {}; Object.keys(ov).forEach(function (k) { c2[k] = ov[k]; }); c2.mergedFrom = oldUser.id; e.votes[newUser.id] = c2; }
        delete e.votes[oldUser.id];
      }
      if (e.devices) Object.keys(e.devices).forEach(function (dk) { if (e.devices[dk] && e.devices[dk].userId === oldUser.id) e.devices[dk].userId = newUser.id; });
    });
    function remap(bag) {
      if (!bag || typeof bag !== 'object') return;
      Object.keys(bag).forEach(function (k) {
        if (Array.isArray(bag[k])) {
          var out = [];
          bag[k].forEach(function (x) { var y = x === oldUser.id ? newUser.id : x; if (out.indexOf(y) === -1) out.push(y); });
          bag[k] = out;
        } else if (bag[k] === oldUser.id) bag[k] = newUser.id;
      });
    }
    remap(db.deviceOwner); remap(db.fpOwner); remap(db.deviceAccounts); remap(db.fpAccounts);
    Object.keys(oldUser.devices || {}).forEach(function (dk) {
      if (!newUser.devices[dk] || Number(oldUser.devices[dk]) > Number(newUser.devices[dk])) newUser.devices[dk] = oldUser.devices[dk];
      recordDeviceAccount(newUser, dk, null);
    });
    oldUser.accountStatus = 'replaced'; oldUser.replacedBy = newUser.id; oldUser.replacedAt = Date.now(); oldUser.tokens = {};
  }

  function findUserById(id) {
    for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i];
    return null;
  }

  /* --------------------------- banner ------------------------------ */
  function showBanner() {
    /* FIX: poore app ko pata chale ki server nahi hai — warna app SSE/polling
       se /api ko baar-baar hit karta rehta hai (static hosting par 404 spam). */
    window.JANMAT_OFFLINE = true;
    var bar = document.getElementById('offlineBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offlineBar';
      bar.className = 'offline-bar';
      document.body.insertBefore(bar, document.body.firstChild);
      document.body.classList.add('has-offline-bar');
    }
    var hasServer = !!apiBase();
    bar.innerHTML = hasServer
      ? '<b>सर्वर से कनेक्शन नहीं बना</b> — साइट अभी डेमो मोड में चल रही है, इसलिए आपका बनाया चुनाव दूसरों को नहीं दिखेगा। '
        + '(Render का सर्वर सोया हो सकता है — पहली बार खुलने में 30–60 सेकंड लगते हैं।) '
        + '<button type="button" class="offline-retry">फिर कोशिश करें</button>'
      : '<b>डेमो प्रीव्यू</b> — यह पेज सिर्फ़ आपके ब्राउज़र में सेव होता है, इसलिए <b>अापका बनाया चुनाव दूसरों को नहीं दिखेगा</b>। सब लोग एक साथ देखें/वोट करें, इसके लिए साइट को सर्वर (Render) से जोड़ें।';
    var retry = bar.querySelector('.offline-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        try { sessionStorage.removeItem(CACHE_KEY); } catch (_) {}
        bar.innerHTML = '<b>सर्वर जगा रहे हैं…</b> कृपया 10–20 सेकंड रुकें, पेज खुद रीलोड होगा।';
        setTimeout(function () { location.reload(); }, 1200);
      });
    }
  }

  /* ------------------------- server probe -------------------------- */
  /* Ek hi baar check karte hain ki asli server hai ya nahi. Static hosting
     (GitHub Pages) par server nahi hota — tab poora app local mode me
     chalta hai aur /api par 404 ki barish nahi hoti. */
  var probe = null;
  var CACHE_KEY = 'jm_no_server';

  /* Server ka address — agar page GitHub Pages par hai aur server Render par,
     to app.js se pehle yeh value set ho jaati hai (template.html me). */
  function apiBase() {
    return String(window.JANMAT_API_BASE || '').replace(/\/+$/, '');
  }

  function ensure() {
    if (probe) return probe;

    /* 🟢 असली सर्वर सेट है (जैसे GitHub Pages + Render) — तो "डेमो/प्रीव्यू" मोड
       कभी नहीं। पहले यहाँ गड़बड़ी थी: Render का सर्वर 15 मिनट बाद सो जाता है,
       पहला health चेक फेल होता था और साइट ऊपर नीला "डेमो प्रीव्यू" बैनर दिखाने
       लगती थी (जबकि डेटा असली सर्वर से ही आ रहा होता था)। अब सीधे मान लेते हैं
       कि सर्वर है; पीछे-पीछे एक health कॉल भेजकर उसे जगा भी देते हैं। */
    if (apiBase()) {
      window.JANMAT_OFFLINE = false;
      probe = Promise.resolve(true);
      try {
        fetch(apiBase() + '/api/health', { method: 'GET', cache: 'no-store' }).catch(function () {});
      } catch (_) {}
      return probe;
    }

    if (location.protocol === 'file:' && !apiBase()) {
      window.JANMAT_OFFLINE = true;
      probe = Promise.resolve(false);
      return probe;
    }
    // Pehle hi pata chal chuka ho (isi tab me) to dobara network chhedne ki
    // zarurat nahi — reload par bhi preview turant khulta hai.
    /* "server nahi hai" yaad rakhne ki zarurat hai (404 spam na ho), par
       hamesha ke liye nahi — 45 सेकंड बाद फिर कोशिश होती है, वरना सर्वर
       आने के बाद भी पुराना टैब डेमो मोड में अटका रह जाता है। */
    try {
      var cachedAt = Number(sessionStorage.getItem(CACHE_KEY) || 0);
      if (cachedAt && Date.now() - cachedAt < 45000) {
        window.JANMAT_OFFLINE = true;
        probe = Promise.resolve(false);
        return probe;
      }
      if (cachedAt) sessionStorage.removeItem(CACHE_KEY);
    } catch (_) {}

    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      window.JANMAT_OFFLINE = false;   // slow server ko offline mat samjho
      probe = Promise.resolve(true);
    }, 6000);

    probe = fetch(apiBase() + '/api/health', { method: 'GET', cache: 'no-store' })
      .then(function (r) {
        if (done) return !r.ok;
        done = true; clearTimeout(timer);
        window.JANMAT_OFFLINE = !r.ok;
        if (!r.ok) { try { sessionStorage.setItem(CACHE_KEY, String(Date.now())); } catch (_) {} }
        return !!r.ok;
      })
      .catch(function () {
        if (done) return false;
        done = true; clearTimeout(timer);
        window.JANMAT_OFFLINE = true;
        try { sessionStorage.setItem(CACHE_KEY, String(Date.now())); } catch (_) {}
        return false;
      });
    return probe;
  }

  /* ---------------------------- handler ---------------------------- */
  function handle(path, opts) {
    window.JANMAT_OFFLINE = true;
    showBanner();
    load();
    opts = opts || {};
    var headers = opts.headers || {};
    var method = (opts.method || 'GET').toUpperCase();
    var body = opts.body || {};
    var qIndex = String(path).indexOf('?');
    var pathname = qIndex === -1 ? String(path) : String(path).slice(0, qIndex);
    var query = qIndex === -1 ? '' : String(path).slice(qIndex + 1);
    var parts = pathname.split('/').filter(Boolean);

    var token = clean(headers['x-user-token'] || '', 80);
    var viewer = null;
    for (var i = 0; i < db.users.length; i++) {
      var uv = db.users[i];
      if (token && uv.pwHash && isActiveUser(uv) && uv.tokens && uv.tokens[token]) { viewer = uv; break; }
    }
    var devToken = clean(headers['x-dev-token'] || '', 80);
    var devOk = !!(devToken && db.devSessions[devToken] && db.devSessions[devToken].expiresAt > Date.now());

    var device = clean(body.deviceId || headers['x-device-id'] || '', 80);
    var deviceKey = device ? 'd:' + device.slice(0, 40) : 'local-preview';
    var fpRaw = clean(headers['x-fp'] || '', 200);
    var fpKey = /^[A-Za-z0-9_-]{16,200}$/.test(fpRaw) ? 'f:' + hashPreview(fpRaw, 'fp') : null;

    /* stats */
    if (method === 'GET' && parts[1] === 'stats') {
      var votes = 0;
      var states = {};
      db.elections.forEach(function (e) {
        if (e.closed) votes += Object.keys(e.votes || {}).length;
        if (e.state) states[e.state] = 1;
      });
      return {
        elections: db.elections.length, votes: votes, states: Object.keys(states).length,
        candidates: db.elections.reduce(function (a, e) { return a + e.candidates.length; }, 0),
        users: db.users.filter(function (u) { return !u.isDemo; }).length,
        dailyLimit: DAILY_LIMIT
      };
    }

    /* auth — Username + PIN (preview me bhi server wale hi niyam) */
    function usersByName(nm) {
      return db.users.filter(function (u) { return u && u.nameLower === nameKey(nm) && !u.deletedAt; });
    }
    function validName(body2) {
      var name = clean(body2.name, 30);
      if (!name) throw err('अपना नाम लिखें।');
      if (name.length < 2) throw err('नाम कम से कम 2 अक्षरों का होना चाहिए।');
      if (!/^[\p{L}\p{M}\p{N} .'_-]+$/u.test(name)) throw err('नाम में सिर्फ़ अक्षर, अंक, स्पेस और . \' _ - चलेंगे।');
      if (['developer', 'dev', 'admin', 'administrator', 'janmat', 'moderator', 'root'].indexOf(nameKey(name)) !== -1) throw err('यह नाम आरक्षित है, कृपया दूसरा नाम चुनें।');
      return name;
    }
    function validUsername(body2) {
      var uv = validateUsername(body2.username);
      if (uv.error) throw err(uv.error, 400);
      return uv.username;
    }
    function validPin(raw, username) {
      var pv = validatePin(raw, username);
      if (pv.error) throw err(pv.error, 400);
      return pv.password;
    }
    function finishAuth(user, extra) {
      if (!user.devices || typeof user.devices !== 'object') user.devices = {};
      if (!user.tokens || typeof user.tokens !== 'object') user.tokens = {};
      user.devices[deviceKey] = Date.now();
      if (!db.deviceOwner) db.deviceOwner = {};
      db.deviceOwner[deviceKey] = user.id;
      if (fpKey) { if (!db.fpOwner) db.fpOwner = {}; db.fpOwner[fpKey] = user.id; }
      recordDeviceAccount(user, deviceKey, fpKey);
      user.lastLoginAt = Date.now();
      var adopted = adoptGuestVotes(user, deviceKey);
      var tk = rid(24);
      user.tokens[tk] = Date.now();
      save();
      var out = { user: pubUser(user), token: tk, quota: quotaFor(user), adoptedVotes: adopted };
      if (extra) Object.keys(extra).forEach(function (k) { out[k] = extra[k]; });
      return out;
    }
    function legacyClaimable(list) {
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        if (!u.pwHash && isActiveUser(u) && ((db.deviceOwner && db.deviceOwner[deviceKey] === u.id) || (fpKey && db.fpOwner && db.fpOwner[fpKey] === u.id) || (u.devices && u.devices[deviceKey]))) return u;
      }
      return null;
    }
    function takenError(username) {
      return err('यह username (@' + username + ') पहले से उपयोग में है — कोई दूसरा चुनें।', 409, 'USERNAME_TAKEN', { suggestions: usernameSuggestions(username) });
    }

    if ((method === 'GET' || method === 'POST') && parts[1] === 'auth' && parts[2] === 'username-available') {
      var rawU = body.username || '';
      query.split('&').forEach(function (kv) { var p2 = kv.split('='); if (p2[0] === 'u') rawU = decodeURIComponent(p2[1] || ''); });
      var uv0 = validateUsername(rawU);
      if (uv0.error) return { available: false, valid: false, error: uv0.error, username: normalizeUsername(rawU) };
      var taken0 = usernameTaken(uv0.username, viewer ? viewer.id : null);
      return { available: !taken0, valid: true, username: uv0.username, error: taken0 ? 'यह username पहले से उपयोग में है — कोई दूसरा चुनें।' : null, suggestions: taken0 ? usernameSuggestions(uv0.username) : [] };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'register') {
      var rname = validName(body);
      var runame = validUsername(body);
      var rpin = validPin(body.password, runame);
      if (usernameTaken(runame)) throw takenError(runame);
      var same = usersByName(rname);
      var lgr = legacyClaimable(same);
      if (lgr) {
        var rc0 = setPreviewPassword(lgr, rpin);
        lgr.name = rname; lgr.username = runame; lgr.accountStatus = 'active';
        return finishAuth(lgr, { claimed: true, recoveryCode: rc0 });
      }
      var conflicts = deviceConflictUsers(deviceKey, fpKey).filter(function (u) { return u.username || u.pwHash || !isActiveUser(u); });
      if (conflicts.length) throw err('इस फ़ोन पर पहले से एक खाता बना हुआ है, इसलिए दूसरा खाता सीधे नहीं बनेगा। अगर आप परिवार के दूसरे सदस्य हैं तो नीचे "Username भूल गए / दूसरा खाता चाहिए" से appeal भेजें — Team Janmat जाँचकर मंज़ूरी देगी।', 409, 'DEVICE_HAS_ACCOUNT');
      var nuser = { id: rid(8), name: rname, nameLower: nameKey(rname), username: runame, accountStatus: 'active', createdAt: Date.now(), lastLoginAt: Date.now(), isDemo: false, devices: {}, tokens: {} };
      var rcode = setPreviewPassword(nuser, rpin);
      db.users.push(nuser);
      return finishAuth(nuser, { isNewAccount: true, recoveryCode: rcode, sameNameExists: same.length > 0 });
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'migrate') {
      var mname = validName(body);
      var muname = validUsername(body);
      var mpin = validPin(body.password, muname);
      if (usernameTaken(muname)) throw takenError(muname);
      var mcands = usersByName(mname).filter(function (u) { return !u.username && isActiveUser(u); });
      var mtarget = null;
      var oldPw = String(body.oldPassword == null ? '' : body.oldPassword);
      if (oldPw) for (var mi = 0; mi < mcands.length; mi++) if (mcands[mi].pwHash && checkPreview(oldPw, mcands[mi].pwHash)) { mtarget = mcands[mi]; break; }
      if (!mtarget) mtarget = legacyClaimable(mcands);
      if (!mtarget) throw err('पुराना खाता साबित नहीं हो सका। पुराना नाम और पुराना पासवर्ड ठीक से लिखें — या उसी पुराने फ़ोन से कोशिश करें जिससे खाता बना था।', 401, 'MIGRATION_FAILED');
      var mrc = setPreviewPassword(mtarget, mpin);
      mtarget.name = mname; mtarget.username = muname; mtarget.accountStatus = 'active'; mtarget.tokens = {};
      return finishAuth(mtarget, { claimed: true, migrated: true, recoveryCode: mrc });
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'set-username') {
      if (!viewer) throw err('लॉगिन नहीं है।', 401, 'LOGIN_REQUIRED');
      if (viewer.username) throw err('आपके खाते पर username (@' + viewer.username + ') पहले से लगा है — username हमेशा के लिए वही रहता है।', 409, 'USERNAME_ALREADY_SET');
      var suname = validUsername(body);
      if (usernameTaken(suname, viewer.id)) throw takenError(suname);
      viewer.username = suname; viewer.accountStatus = 'active'; save();
      return { ok: true, user: pubUser(viewer), quota: quotaFor(viewer) };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'login') {
      var luv = validateUsername(body.username);
      if (luv.error) throw err('अपना सही username लिखें (जैसे pawan_verma) — लॉगिन अब नाम से नहीं, username से होता है।', 400, 'USERNAME_REQUIRED');
      var lpass = String(body.password == null ? '' : body.password);
      if (!lpass) throw err('अपना PIN लिखें।', 400, 'PASSWORD_REQUIRED');
      var luser = findUserByUsername(luv.username);
      if (!luser) {
        syncApplications();
        var pending = null;
        db.accountApplications.forEach(function (a) { if (a && a.status === 'pending' && a.desiredUsername === luv.username) pending = a; });
        if (pending) throw err('यह खाता अभी Team Janmat की जाँच में है (Pending)। मंज़ूरी मिलते ही इसी username + PIN से लॉगिन होगा।', 401, 'ACCOUNT_PENDING');
        throw err('इस username का कोई खाता नहीं मिला। Username ध्यान से देखें — या "नया खाता बनाएँ" चुनें।', 401, 'ACCOUNT_NOT_FOUND');
      }
      var lblocked = inactiveAccountError(luser, 'login'); if (lblocked) throw lblocked;
      if (!luser.pwHash || !checkPreview(lpass, luser.pwHash)) throw err('PIN सही नहीं है। ध्यान से दोबारा लिखें — या "PIN भूल गए" से रिकवरी कोड इस्तेमाल करें।', 401, 'WRONG_PASSWORD');
      return finishAuth(luser, {});
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'recover') {
      var runame2 = validUsername(body);
      var rpin2 = validPin(body.newPassword, runame2);
      var ruser = findUserByUsername(runame2);
      var want = String(body.recoveryCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!ruser) throw err('कारण: इस username (@' + runame2 + ') का कोई खाता ही नहीं मिला। username की spelling ध्यान से देखें — लॉगिन कार्ड पर लिखा username बिल्कुल वैसा ही लिखें।', 401, 'ACCOUNT_NOT_FOUND');
      var rblocked = inactiveAccountError(ruser, 'recover'); if (rblocked) throw rblocked;
      if (want.length !== 12) throw err('कारण: रिकवरी कोड अधूरा लिखा है। कोड कुल 12 अक्षरों का होता है (जैसे ABCD-EFGH-JKLM) — आपने ' + want.length + ' अक्षर लिखे हैं। कार्ड देखकर पूरा कोड लिखें।', 400, 'RECOVERY_CODE_FORMAT');
      if (!ruser.recoveryHash) throw err('कारण: इस (पुराने) खाते पर रिकवरी कोड सेट ही नहीं है। नीचे "खाता वापसी आवेदन" भेजें — Team Janmat जाँचकर आपके उसी खाते पर नया PIN लगा देगी।', 401, 'RECOVERY_NOT_SET');
      if (!checkPreview(want, ruser.recoveryHash)) throw err('कारण: यह रिकवरी कोड इस खाते के मौजूदा कोड से मेल नहीं खाता। एक भी अक्षर गलत हो तो कोड नहीं चलेगा (कोड में O, I, 0, 1 होते ही नहीं)। अगर आपको पहले कभी नया कार्ड मिला था या आपने Settings से नया कोड बनाया था, तो वही सबसे नया कोड लगेगा — पुराना कार्ड नहीं चलेगा। कार्ड ही खो गया हो तो नीचे "खाता वापसी आवेदन" भेजें।', 401, 'RECOVERY_CODE_WRONG');
      var rsalt2 = rid(8);
      ruser.pwHash = rsalt2 + ':' + hashPreview(rpin2, rsalt2);   /* v8.2.3: कोड वही रहता है, नया कार्ड नहीं */
      ruser.tokens = {};
      return finishAuth(ruser, { recovered: true, recoveryCodeKept: true });
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'recovery-code') {
      if (!viewer) throw err('कारण: लॉगिन नहीं है। नया रिकवरी कोड सिर्फ़ अपने खाते में लॉगिन के बाद बनता है।', 401, 'LOGIN_REQUIRED');
      if (!checkPreview(String(body.currentPassword || ''), viewer.pwHash)) throw err('कारण: मौजूदा PIN सही नहीं है, इसलिए नया कोड नहीं बना। ध्यान से दोबारा लिखें।', 401, 'WRONG_PASSWORD');
      var ncode = makeRecovery();
      viewer.recoveryHash = previewHash(ncode.replace(/[^A-Z0-9]/g, ''));
      save();
      return { ok: true, recoveryCode: ncode, user: pubUser(viewer), message: 'नया रिकवरी कोड बन गया। पुराना कोड अब नहीं चलेगा — नया कार्ड/कोड सँभाल लें।' };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'username-hint') {
      var husers = deviceConflictUsers(deviceKey, fpKey).filter(function (u) { return u.username; });
      if (!husers.length) return { ok: false, hint: null, message: 'इस फ़ोन से कोई खाता जुड़ा नहीं मिला। लॉगिन कार्ड देखें या नीचे appeal भेजें।' };
      husers.sort(function (a, b) { return (b.lastLoginAt || 0) - (a.lastLoginAt || 0); });
      return { ok: true, count: husers.length, hints: husers.slice(0, 3).map(function (u) { return { usernameMasked: '@' + maskUsername(u.username), name: u.name }; }), message: 'क्या इनमें से कोई आपका username है? पूरा username लॉगिन कार्ड पर लिखा होता है।' };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'apply') {
      var akind = body.kind === 'device-second-account' ? 'device-second-account' : body.kind === 'lost-pin-recovery' ? 'lost-pin-recovery' : 'forgot-username';
      var aname = validName(body);
      var auname = validUsername(body);
      var apin = validPin(body.password, auname);
      var areason = clean(body.reason, 300);
      if (areason.length < 8) throw err('कारण थोड़ा साफ़ लिखें (कम से कम 8 अक्षर) — जैसे "पुराना username भूल गया, फ़ोन यही है"।');
      var lostT = null;
      if (akind === 'lost-pin-recovery') {
        lostT = findUserByUsername(auname);
        if (lostT) { var lostBlocked = inactiveAccountError(lostT, 'login'); if (lostBlocked) throw lostBlocked; }
        if (!lostT) throw err('कारण: इस username (@' + auname + ') का कोई चालू खाता नहीं मिला। वही username लिखें जो आपके खाते पर था — spelling ध्यान से देखें।', 404, 'ACCOUNT_NOT_FOUND');
      } else if (usernameTaken(auname)) throw err('यह username (@' + auname + ') पहले से उपयोग/जाँच में है — कोई दूसरा चुनें।', 409, 'USERNAME_TAKEN', { suggestions: usernameSuggestions(auname) });
      syncApplications();
      var dupApp = null;
      db.accountApplications.forEach(function (a) { if (a && a.status === 'pending' && a.device === deviceKey && a.desiredUsername === auname) dupApp = a; });
      if (dupApp) throw err('इसी username का आपका आवेदन पहले से जाँच में है। आवेदन नंबर: ' + dupApp.id, 409, 'APPLICATION_PENDING', { applicationId: dupApp.id });
      if (akind === 'lost-pin-recovery') {
        var dupL = null;
        db.accountApplications.forEach(function (a) { if (a && a.status === 'pending' && a.kind === 'lost-pin-recovery' && a.desiredUsername === auname) dupL = a; });
        if (dupL) throw err('कारण: इस खाते (@' + auname + ') की वापसी का आवेदन पहले से जाँच में है। आवेदन नंबर: ' + dupL.id + ' — स्थिति नीचे देख सकते हैं।', 409, 'APPLICATION_PENDING', { applicationId: dupL.id });
      }
      var areceipt = rid(14);
      var arecovery = makeRecovery();
      var aconf = deviceConflictUsers(deviceKey, fpKey).map(function (u) { return u.id; });
      if (lostT && aconf.indexOf(lostT.id) === -1) aconf.push(lostT.id);
      var newApp = {
        id: 'APP-' + rid(4).toUpperCase(), kind: akind, name: aname, desiredUsername: auname,
        pwHash: previewHash(apin), recoveryHash: previewHash(arecovery.replace(/[^A-Z0-9]/g, '')),
        receiptHash: hashPreview(areceipt, 'receipt'), reason: areason, device: deviceKey, fp: fpKey || null,
        conflictUserIds: aconf,
        status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 7 * 864e5,
        decidedAt: null, decisionNote: '', resultingUserId: null, replacedUserId: null,
        targetUserId: lostT ? lostT.id : null
      };
      db.accountApplications.push(newApp); save();
      return { ok: true, applicationId: newApp.id, receipt: areceipt, recoveryCode: arecovery, status: 'pending', message: akind === 'lost-pin-recovery'
          ? 'आपका खाता-वापसी आवेदन Team Janmat के पास जाँच में है। मंज़ूरी मिलते ही आपके पुराने खाते (@' + auname + ') पर यही चुना हुआ नया PIN लग जाएगा और नीचे वाला नया रिकवरी कोड चालू होगा। आवेदन नंबर और कोड सँभालकर रखें।'
          : 'आपका आवेदन Team Janmat के पास जाँच में है। मंज़ूरी मिलने पर इसी username + PIN से लॉगिन होगा। रिकवरी कोड और आवेदन नंबर सँभालकर रखें।' };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'application-status') {
      syncApplications();
      var appId = clean(body.applicationId, 24).toUpperCase();
      var appObj = null;
      if (appId) db.accountApplications.forEach(function (a) { if (a && a.id === appId) appObj = a; });
      if (!appObj && deviceKey) {
        var mineApps = db.accountApplications.filter(function (a) { return a && a.device === deviceKey; }).sort(function (a, b) { return b.createdAt - a.createdAt; });
        appObj = mineApps[0] || null;
      }
      if (!appObj) throw err('इस फ़ोन पर कोई आवेदन नहीं मिला। आवेदन नंबर ठीक से लिखें।', 404);
      var receipt = clean(body.receipt, 60);
      var receiptOk = receipt && appObj.receiptHash === hashPreview(receipt, 'receipt');
      if (!receiptOk && appObj.device !== deviceKey) throw err('यह आवेदन इस फ़ोन/रसीद से नहीं खुल सकता।', 403);
      return {
        ok: true, applicationId: appObj.id, status: appObj.status, username: appObj.desiredUsername, name: appObj.name,
        createdAt: appObj.createdAt, decidedAt: appObj.decidedAt || null, decisionNote: appObj.decisionNote || '',
        message: appObj.status === 'approved' ? (appObj.kind === 'lost-pin-recovery' ? 'बधाई हो! आपके पुराने खाते (@' + appObj.desiredUsername + ') पर आवेदन वाला नया PIN लग गया है — उसी PIN से लॉगिन करें।' : 'बधाई हो! आपका खाता बन गया है — अब अपने username + PIN से लॉगिन करें।')
          : appObj.status === 'rejected' ? 'क्षमा करें, यह आवेदन मंज़ूर नहीं हुआ। कारण ऊपर दिया है।'
          : appObj.status === 'expired' ? 'यह आवेदन 7 दिन पूरे होने पर समाप्त हो गया — चाहें तो फिर से आवेदन भेजें।'
          : 'आपका आवेदन Team Janmat की जाँच में है। मंज़ूरी मिलते ही यहीं पता चल जाएगा।'
      };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'password') {
      if (!viewer) throw err('लॉगिन नहीं है।', 401, 'LOGIN_REQUIRED');
      if (!viewer.pwHash || !checkPreview(String(body.oldPassword || ''), viewer.pwHash)) throw err('मौजूदा PIN सही नहीं है।', 401, 'WRONG_PASSWORD');
      var npin = validPin(body.newPassword, viewer.username);
      viewer.pwHash = previewHash(npin);
      var oldTok = token && viewer.tokens[token];
      viewer.tokens = oldTok ? {} : {};
      if (oldTok) viewer.tokens[token] = oldTok;
      save();
      return { ok: true, message: 'PIN बदल गया।' };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'auto') {
      var oid = db.deviceOwner && db.deviceOwner[deviceKey];
      if (!oid && fpKey && db.fpOwner) oid = db.fpOwner[fpKey];
      var ou = oid ? findUserById(oid) : null;
      return { ok: false, hint: ou && !ou.deletedAt ? { name: ou.name, usernameMasked: ou.username ? '@' + maskUsername(ou.username) : null, via: db.deviceOwner[deviceKey] ? 'device' : 'fingerprint' } : null, passwordRequired: true };
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'rebind') {
      throw err('अब लॉगिन username + PIN से होता है — फ़ोन से नाम छुड़ाने की ज़रूरत नहीं। अपने username से लॉगिन करें।', 410, 'REBIND_RETIRED');
    }

    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'logout') {
      if (viewer && token && viewer.tokens[token]) { delete viewer.tokens[token]; save(); }
      return { ok: true };
    }

    if (method === 'GET' && parts[1] === 'auth' && parts[2] === 'me') {
      if (!viewer) throw err('लॉगिन नहीं है।', 401, 'LOGIN_REQUIRED');
      return {
        user: pubUser(viewer), quota: quotaFor(viewer),
        counts: {
          elections: db.elections.filter(function (e) { return e.creatorId === viewer.id; }).length,
          votes: db.elections.filter(function (e) { return e.votes[viewer.id]; }).length
        }
      };
    }

    /* elections list */
    if (method === 'GET' && parts[1] === 'elections' && parts.length === 2) {
      var search = '';
      query.split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0] === 'q') search = decodeURIComponent(p[1] || '').toLowerCase();
      });
      var list = db.elections.slice().sort(function (a, b) { return b.createdAt - a.createdAt; });
      if (search) {
        list = list.filter(function (e) {
          return [e.title, e.gram, e.district, e.state, e.type, e.code].join(' ').toLowerCase().indexOf(search) !== -1;
        });
      }
      list.sort(function (a, b) {
        if (!!a.closed !== !!b.closed) return a.closed ? 1 : -1;
        if (!a.closed && !b.closed) {
          var ae = Number(a.endsAt) > 0 ? Number(a.endsAt) : Infinity;
          var be = Number(b.endsAt) > 0 ? Number(b.endsAt) : Infinity;
          if (ae !== be) return ae - be;
        }
        return b.createdAt - a.createdAt;
      });
      var st = {};
      db.elections.forEach(function (e) { if (e.state) st[e.state] = 1; });
      return { elections: list.map(summary), states: Object.keys(st).sort(), totalElections: db.elections.length };
    }

    /* elections create */
    if (method === 'POST' && parts[1] === 'elections' && parts.length === 2) {
      if (!viewer) throw err('चुनाव बनाने के लिए पहले username से लॉगिन करें।', 401, 'LOGIN_REQUIRED');
      var q = quotaFor(viewer);
      if (q.remaining <= 0) {
        throw err('आप आज की सीमा (' + q.limit + ' चुनाव प्रतिदिन) पूरी कर चुके हैं। कल फिर कोशिश करें।', 403, 'DAILY_LIMIT', { quota: q });
      }
      var gram = clean(body.gram, 90);
      var district = clean(body.district, 60);
      var state = clean(body.state, 60);
      var type = clean(body.type, 40) || 'अन्य';
      if (!gram) throw err('गाँव / क्षेत्र का नाम ज़रूरी है।');
      if (!district) throw err('ज़िला ज़रूरी है।');
      if (!state) throw err('राज्य ज़रूरी है।');
      var cands = [];
      (Array.isArray(body.candidates) ? body.candidates : []).forEach(function (c) {
        var nm = clean(c && c.name, 60);
        if (!nm) return;
        cands.push({ id: rid(6), name: nm, party: clean(c && c.party, 50), symbol: clean(c && c.symbol, 24) || 'diya' });
      });
      if (cands.length < 2) throw err('कम से कम 2 उम्मीदवारों के नाम डालें।');
      var e = {
        code: newCode(), title: clean(body.title, 110) || (gram + ' — ' + type + ' चुनाव'),
        type: type, gram: gram, district: district, state: state,
        createdAt: Date.now(), closed: false, closedAt: null, creatorId: viewer.id, isDemo: false,
        candidates: cands, votes: {}, devices: {}
      };
      db.elections.push(e);
      save();
      return { election: full(e, viewer), quota: quotaFor(viewer) };
    }

    var election = parts[1] === 'elections' && parts[2] ? findElection(parts[2]) : null;
    if (parts[1] === 'elections' && parts[2] && !election) throw err('चुनाव नहीं मिला।', 404);

    if (method === 'GET' && election && parts.length === 3) {
      var whoGet = viewer || { id: 'g:' + deviceKey, name: 'मेहमान मतदाता', guest: true };
      return full(election, whoGet);
    }

    if (method === 'POST' && election && parts[3] === 'vote') {
      if (election.closed) throw err('यह चुनाव समाप्त हो चुका है, अब वोट नहीं डाला जा सकता।', 403);
      var candidateId = clean(body.candidateId, 40);
      var cand = null;
      election.candidates.forEach(function (c) { if (c.id === candidateId) cand = c; });
      if (!cand) throw err('उम्मीदवार नहीं मिला।');
      var voterId = viewer ? viewer.id : 'g:' + deviceKey;
      var voterObj = viewer || { id: voterId, name: 'मेहमान मतदाता', guest: true };
      if (!election.votes) election.votes = {};
      if (!election.devices) election.devices = {};
      if (election.votes[voterId]) throw err('आप इस चुनाव में पहले ही वोट कर चुके हैं।', 409, 'ALREADY_VOTED', { election: full(election, voterObj) });
      var fpAlready = !!(fpKey && election.fpVotes && election.fpVotes[fpKey] && election.fpVotes[fpKey].length);
      /* override सिर्फ़ लॉगिन खाते को — Guest को कभी नहीं (इनकॉग्निटो दुरुपयोग रोक) */
      var overrideOk = fpAlready && body.overrideSamePhone === true && !!viewer;
      if (fpAlready && !overrideOk) {
        throw err(viewer
          ? 'इस फ़ोन से इस चुनाव में पहले ही वोट दिया जा चुका है। एक फ़ोन से एक ही वोट मान्य है।'
          : 'इस फ़ोन से इस चुनाव में पहले ही वोट दिया जा चुका है। बिना खाते के (Guest) इस फ़ोन से दोबारा वोट नहीं हो सकता। अगर आप परिवार के दूसरे सदस्य हैं, तो पहले अपने खाते से लॉगिन करें (नया खाता Developer की मंज़ूरी से बनता है) — फिर वोट कर पाएँगे।',
          409, 'SAME_PHONE_VOTED', { allowOverride: !!viewer, election: full(election, voterObj) });
      }
      if (election.devices[deviceKey]) {
        throw err('इस फ़ोन/डिवाइस से इस चुनाव में वोट दिया जा चुका है। एक डिवाइस से सिर्फ़ एक ही वोट मान्य है।', 409, 'DEVICE_VOTED', { election: full(election, voterObj) });
      }
      election.votes[voterId] = { c: cand.id, at: Date.now(), device: deviceKey, guest: !viewer, fp: fpKey || null, samePhoneOverride: !!(fpAlready && body.overrideSamePhone === true) };
      election.devices[deviceKey] = { userId: voterId, at: Date.now() };
      if (fpKey) {
        if (!election.fpVotes) election.fpVotes = {};
        if (!election.fpVotes[fpKey]) election.fpVotes[fpKey] = [];
        if (election.fpVotes[fpKey].indexOf(voterId) === -1) election.fpVotes[fpKey].push(voterId);
      }
      save();
      return { ok: true, votedFor: { id: cand.id, name: cand.name, symbol: cand.symbol }, election: full(election, voterObj) };
    }

    if (method === 'POST' && election && (parts[3] === 'close' || parts[3] === 'reopen')) {
      var isCreator = !!(viewer && election.creatorId === viewer.id);
      if (!isCreator && !devOk) throw err('सिर्फ़ चुनाव बनाने वाला (या डेवलपर) इसे बंद कर सकता है।', 403);
      election.closed = parts[3] === 'close';
      election.closedAt = election.closed ? Date.now() : null;
      save();
      return full(election, viewer);
    }

    /* my overview */
    if (method === 'GET' && parts[1] === 'me' && parts[2] === 'overview') {
      if (!viewer) throw err('लॉगिन नहीं है।', 401, 'LOGIN_REQUIRED');
      var myE = db.elections.filter(function (e) { return e.creatorId === viewer.id; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; })
        .map(function (e) {
          var s = summary(e);
          var tt = tally(e);
          s.leading = e.closed ? (tt.candidates[0] || null) : null;
          s.canManage = true;
          return s;
        });
      var myV = db.elections.filter(function (e) { return e.votes[viewer.id]; })
        .sort(function (a, b) { return b.votes[viewer.id].at - a.votes[viewer.id].at; })
        .map(function (e) {
          var v = e.votes[viewer.id];
          var c = null;
          e.candidates.forEach(function (x) { if (x.id === v.c) c = x; });
          return {
            code: e.code, title: e.title, gram: e.gram, district: e.district, state: e.state,
            at: v.at, closed: !!e.closed,
            candidate: c ? { name: c.name, symbol: c.symbol || 'diya', party: c.party || '' } : null
          };
        });
      return { user: pubUser(viewer), quota: quotaFor(viewer), elections: myE, votes: myV };
    }

    /* developer */
    if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'login') {
      if (String(body.password || '') !== PREVIEW_DEV_PASS) throw err('गलत पासवर्ड।', 401);
      var dToken = rid(28);
      db.devSessions[dToken] = { createdAt: Date.now(), expiresAt: Date.now() + 12 * 3600 * 1000 };
      save();
      return { devToken: dToken, expiresAt: db.devSessions[dToken].expiresAt, storage: 'preview' };
    }
    if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'logout') {
      if (db.devSessions[devToken]) { delete db.devSessions[devToken]; save(); }
      return { ok: true };
    }
    if (parts[1] === 'dev' && !devOk) throw err('डेवलपर लॉगिन ज़रूरी है।', 401, 'DEV_LOGIN_REQUIRED');

    if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'overview') {
      var users = db.users.map(function (u) {
        syncUserBan(u);
        var created = db.elections.filter(function (e) { return e.creatorId === u.id; });
        var voted = db.elections.filter(function (e) { return e.votes[u.id]; });
        var modInfo = moderationInfo(u);
        return {
          id: u.id, name: u.name, username: u.username || null, accountStatus: modInfo.accountStatus,
          deletedAt: modInfo.deletedAt, deletedBy: modInfo.deletedBy, deleteReason: modInfo.deleteReason,
          banType: modInfo.banType, bannedAt: modInfo.bannedAt, banUntil: modInfo.banUntil, banReason: modInfo.banReason, banBy: modInfo.banBy,
          moderationHistory: Array.isArray(u.moderationHistory) ? u.moderationHistory.slice(-5) : [],
          hasPassword: !!u.pwHash,
          createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, isDemo: !!u.isDemo,
          electionsCreated: created.length, votesCast: voted.length,
          deviceCount: Object.keys(u.devices || {}).length,
          electionCodes: created.map(function (e) { return e.code; })
        };
      }).sort(function (a, b) { return (b.lastLoginAt || 0) - (a.lastLoginAt || 0); });

      var elections = db.elections.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).map(function (e) {
        var t = tally(e);
        var cr = findUserById(e.creatorId);
        return {
          code: e.code, title: e.title, type: e.type, gram: e.gram, district: e.district, state: e.state,
          createdAt: e.createdAt, closed: !!e.closed, closedAt: e.closedAt || null, isDemo: !!e.isDemo,
          creatorId: e.creatorId, creatorName: cr ? cr.name : 'अज्ञात', creatorUsername: cr ? (cr.username || null) : null, creatorIsDemo: cr ? !!cr.isDemo : false,
          totalVotes: t.totalVotes, candidateCount: e.candidates.length,
          deviceCount: Object.keys(e.devices || {}).length,
          leading: t.candidates[0] || null, winner: e.closed ? (t.candidates[0] || null) : null
        };
      });

      var voteRows = [];
      db.elections.forEach(function (e) {
        Object.keys(e.votes || {}).forEach(function (uid) {
          var v = e.votes[uid];
          var u = findUserById(uid);
          var c = null;
          e.candidates.forEach(function (x) { if (x.id === (v && v.c)) c = x; });
          voteRows.push({
            at: (v && v.at) || 0, userId: uid,
            userName: u ? u.name : (v && v.linkedName ? v.linkedName : (String(uid).indexOf('g:') === 0 ? 'मेहमान मतदाता' : 'अज्ञात उपयोगकर्ता')),
            userUsername: u ? (u.username || null) : null,
            linkedName: (v && v.linkedName) || null,
            linkedUsername: (v && v.linkedUsername) || (u && v && v.sourceGuest ? (u.username || null) : null),
            voteSource: (v && v.sourceGuest) ? 'guest-first' : (String(uid).indexOf('g:') === 0 ? 'guest' : 'account'),
            adopted: !!(v && v.adoptedAt),
            userIsDemo: u ? !!u.isDemo : false,
            electionCode: e.code, electionTitle: e.title, electionDemo: !!e.isDemo,
            candidateId: c ? c.id : null, candidateName: c ? c.name : '—',
            candidateSymbol: c ? c.symbol || 'diya' : 'diya', candidateParty: c ? c.party || '' : '',
            deviceShort: v && v.device ? String(v.device).slice(0, 10) : ''
          });
        });
      });
      voteRows.sort(function (a, b) { return b.at - a.at; });

      var today = istDay();
      return {
        stats: {
          users: db.users.filter(function (u) { return !u.isDemo; }).length,
          demoUsers: db.users.filter(function (u) { return u.isDemo; }).length,
          elections: db.elections.length, votes: voteRows.length,
          todayElections: db.elections.filter(function (e) { return istDay(e.createdAt) === today; }).length,
          todayVotes: voteRows.filter(function (v) { return istDay(v.at) === today; }).length,
          storage: 'preview', dailyLimit: DAILY_LIMIT, serverTime: Date.now()
        },
        usage: {
          monthKey: 'preview', commands: 0, commandQuota: 500000,
          votesThisMonth: voteRows.length, electionsThisMonth: db.elections.length,
          dbBytes: JSON.stringify(db).length, dbBytesQuota: 250 * 1024 * 1024,
          openComplaints: 0,
          pendingApplications: (db.accountApplications || []).filter(function (a) { return a && a.status === 'pending'; }).length,
          accountsWithoutUsername: db.users.filter(function (u) { return u && !u.username && !u.isDemo && isActiveUser(u); }).length
        },
        users: users, elections: elections, votes: voteRows.slice(0, 1000)
      };
    }

    if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'users' && parts[3] && parts[4] === 'moderate' && parts.length === 5) {
      var modUser = findUserById(clean(parts[3], 40));
      if (!modUser) throw err('यह खाता नहीं मिला। सूची ताज़ा करके फिर देखें।', 404);
      syncUserBan(modUser);
      var modAction = clean(body.action, 30);
      var modReason = clean(body.reason, 200);
      var modNow = Date.now();
      var modStatus = modUser.deletedAt ? 'deleted' : (modUser.accountStatus || 'active');
      if (['ban-temporary', 'ban-permanent', 'unban', 'delete'].indexOf(modAction) === -1) throw err('खाता कार्रवाई सही नहीं है।', 400);
      if (modStatus === 'deleted') throw err('यह खाता पहले ही हटाया जा चुका है।', 409, 'ACCOUNT_DELETED');
      if (modStatus === 'replaced') throw err('यह पुराना बदला हुआ (replaced) खाता है — इसका login पहले ही बंद है। नए खाते पर कार्रवाई करें।', 409, 'ACCOUNT_REPLACED');
      var modMessage = '';
      if (modAction === 'ban-temporary') {
        var modDays = Number(body.days);
        if (!isFinite(modDays) || Math.floor(modDays) !== modDays || modDays < 1 || modDays > 3650) throw err('रोक के दिन सही लिखें — 1 से 3650 दिनों के बीच पूरा नंबर होना चाहिए।', 400);
        modUser.accountStatus = 'banned'; modUser.banType = 'temporary'; modUser.bannedAt = modNow;
        modUser.banUntil = modNow + modDays * 864e5; modUser.banReason = modReason; modUser.banBy = 'developer'; modUser.tokens = {};
        noteUserModeration(modUser, modAction, modReason, modUser.banUntil, 'developer');
        modMessage = 'खाते पर ' + modDays + ' दिन की रोक लग गई — ' + formatBanDate(modUser.banUntil) + ' तक login बंद रहेगा।';
      } else if (modAction === 'ban-permanent') {
        modUser.accountStatus = 'banned'; modUser.banType = 'permanent'; modUser.bannedAt = modNow;
        modUser.banUntil = null; modUser.banReason = modReason; modUser.banBy = 'developer'; modUser.tokens = {};
        noteUserModeration(modUser, modAction, modReason, null, 'developer');
        modMessage = 'खाते पर स्थायी रोक लग गई। आपके द्वारा रोक हटाए जाने तक login बंद रहेगा।';
      } else if (modAction === 'unban') {
        if (modStatus !== 'banned') throw err('इस खाते पर अभी कोई रोक लगी ही नहीं है।', 409, 'ACCOUNT_NOT_BANNED');
        modUser.accountStatus = 'active'; modUser.unbannedAt = modNow; clearBanFields(modUser); modUser.tokens = {};
        noteUserModeration(modUser, modAction, modReason, null, 'developer');
        modMessage = 'रोक हट गई — खाता फिर चालू है। उपयोगकर्ता को username + PIN से दोबारा login करना होगा।';
      } else if (modAction === 'delete') {
        if (body.confirm !== true) throw err('खाता हटाने की पुष्टि ज़रूरी है।', 400);
        softDeleteAccount(modUser, 'developer', modReason);
        noteUserModeration(modUser, modAction, modReason, null, 'developer');
        modMessage = 'खाता हटा दिया गया। login और credential बंद हैं; पुराने चुनाव/वोटों की गिनती बिना नाम के सुरक्षित रहेगी।';
      }
      save();
      var modInfoOut = moderationInfo(modUser);
      modInfoOut.id = modUser.id; modInfoOut.name = modUser.name; modInfoOut.username = modUser.username || null;
      return { ok: true, action: modAction, message: modMessage, user: modInfoOut };
    }

    if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'elections' && parts[3]) {
      var e2 = findElection(parts[3]);
      if (!e2) throw err('चुनाव नहीं मिला।', 404);
      var creator = findUserById(e2.creatorId);
      var rows = Object.keys(e2.votes || {}).map(function (uid) {
        var v = e2.votes[uid];
        var u = findUserById(uid);
        var c = null;
        e2.candidates.forEach(function (x) { if (x.id === (v && v.c)) c = x; });
        return {
          at: (v && v.at) || 0,
          userName: u ? u.name : (v && v.linkedName ? v.linkedName : (String(uid).indexOf('g:') === 0 ? 'मेहमान मतदाता' : 'अज्ञात')),
          userUsername: u ? (u.username || null) : null,
          linkedName: (v && v.linkedName) || null,
          linkedUsername: (v && v.linkedUsername) || (u && v && v.sourceGuest ? (u.username || null) : null),
          voteSource: (v && v.sourceGuest) ? 'guest-first' : (String(uid).indexOf('g:') === 0 ? 'guest' : 'account'),
          adopted: !!(v && v.adoptedAt),
          userIsDemo: u ? !!u.isDemo : false,
          candidateName: c ? c.name : '—', candidateSymbol: c ? c.symbol || 'diya' : 'diya',
          deviceShort: v && v.device ? String(v.device).slice(0, 10) : ''
        };
      }).sort(function (a, b) { return b.at - a.at; });
      var outE = full(e2, null);
      outE.results = tally(e2);
      outE.totalVotes = outE.results.totalVotes;
      outE.results.resultsHidden = false;
      outE.resultsHidden = false;
      outE.resultsVisible = true;
      outE.creatorName = creator ? creator.name : 'अज्ञात';
      outE.creatorUsername = creator ? (creator.username || null) : null;
      outE.creatorId = e2.creatorId;
      return { election: outE, votes: rows };
    }

    if (method === 'GET' && parts[1] === 'dev' && parts[2] === 'applications' && parts.length === 3) {
      syncApplications();
      var rank = { pending: 0, approved: 1, rejected: 2, expired: 3 };
      var applications = db.accountApplications.slice().sort(function (a, b) {
        return ((rank[a.status] == null ? 9 : rank[a.status]) - (rank[b.status] == null ? 9 : rank[b.status])) || (b.createdAt - a.createdAt);
      }).slice(0, 300).map(function (a) {
        return {
          id: a.id, kind: a.kind, name: a.name, desiredUsername: a.desiredUsername, reason: a.reason,
          status: a.status, createdAt: a.createdAt, expiresAt: a.expiresAt || null, decidedAt: a.decidedAt || null,
          decisionNote: a.decisionNote || '', resultingUserId: a.resultingUserId || null, replacedUserId: a.replacedUserId || null,
          conflicts: (a.conflictUserIds || []).map(function (id) { return findUserById(id); }).filter(Boolean).map(function (u) {
            return {
              id: u.id, name: u.name, username: u.username || null, accountStatus: moderationInfo(u).accountStatus, deletedAt: u.deletedAt || null, banType: u.accountStatus === 'banned' ? (u.banType || 'permanent') : null, banUntil: u.accountStatus === 'banned' && u.banType === 'temporary' ? (Number(u.banUntil) || null) : null, banReason: u.accountStatus === 'banned' ? (u.banReason || '') : '',
              hasPassword: !!u.pwHash, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null,
              electionsCreated: db.elections.filter(function (e) { return e.creatorId === u.id; }).length,
              votesCast: db.elections.filter(function (e) { return e.votes && e.votes[u.id]; }).length
            };
          })
        };
      });
      return {
        applications: applications,
        stats: {
          total: applications.length,
          pending: applications.filter(function (a) { return a.status === 'pending'; }).length,
          approved: applications.filter(function (a) { return a.status === 'approved'; }).length,
          rejected: applications.filter(function (a) { return a.status === 'rejected'; }).length
        }
      };
    }

    if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'applications' && parts[3] && (parts[4] === 'approve' || parts[4] === 'reject')) {
      syncApplications();
      var dapp = null;
      db.accountApplications.forEach(function (a) { if (a && a.id === String(parts[3]).toUpperCase()) dapp = a; });
      if (!dapp) throw err('आवेदन नहीं मिला।', 404);
      if (dapp.status !== 'pending') throw err('इस आवेदन पर पहले ही निर्णय हो चुका है (' + dapp.status + ')।', 409);
      var dnote = clean(body.note, 300);
      if (parts[4] === 'reject') {
        dapp.status = 'rejected'; dapp.decidedAt = Date.now();
        dapp.decisionNote = dnote || 'Team Janmat की जाँच में यह आवेदन मंज़ूर नहीं हो सका।';
        dapp.pwHash = null; dapp.recoveryHash = null; save();
        return { ok: true, applicationId: dapp.id, status: 'rejected' };
      }
      if (dapp.kind === 'lost-pin-recovery') {
        var lt = (dapp.targetUserId && findUserById(dapp.targetUserId)) || findUserByUsername(dapp.desiredUsername);
        if (!lt) throw err('जिस खाते (@' + dapp.desiredUsername + ') की वापसी माँगी गई थी वह अब नहीं मिला — यह आवेदन अस्वीकार करें।', 404);
        if (!isActiveUser(lt)) throw err(lt.accountStatus === 'banned' ? 'यह खाता अभी रोक (ban) में है — PIN reset करने से पहले यूज़र्स सूची से रोक हटाएँ।' : 'यह खाता अब चालू नहीं है — PIN वापसी मंज़ूर नहीं हो सकती। आवेदन अस्वीकार करें।', 409, 'ACCOUNT_NOT_ACTIVE');
        lt.pwHash = dapp.pwHash; lt.recoveryHash = dapp.recoveryHash;
        lt.accountStatus = 'active'; lt.tokens = {};
        if (!lt.devices) lt.devices = {};
        lt.devices[dapp.device] = Date.now(); db.deviceOwner[dapp.device] = lt.id;
        if (dapp.fp) db.fpOwner[dapp.fp] = lt.id;
        recordDeviceAccount(lt, dapp.device, dapp.fp || null);
        dapp.status = 'approved'; dapp.decidedAt = Date.now(); dapp.decisionNote = dnote;
        dapp.resultingUserId = lt.id; dapp.replacedUserId = null; dapp.pwHash = null; dapp.recoveryHash = null; save();
        return { ok: true, applicationId: dapp.id, status: 'approved', resultingUserId: lt.id, username: lt.username, pinReset: true };
      }
      var replaceId = clean(body.replaceUserId, 40);
      var dmode = clean(body.mode, 24);
      var dconflicts = (dapp.conflictUserIds || []).map(function (id) { return findUserById(id); }).filter(isActiveUser);
      var target = replaceId ? findUserById(replaceId) : null;
      if (replaceId && !target) throw err('बदला जाने वाला पुराना खाता नहीं मिला।');
      if (target && !isActiveUser(target)) throw err(target.accountStatus === 'banned' ? 'बदला जाने वाला खाता अभी रोक (ban) में है — पहले यूज़र्स सूची से रोक हटाएँ।' : 'बदला जाने वाला पुराना खाता अब चालू नहीं है।', 409, 'ACCOUNT_NOT_ACTIVE');
      if (!target && dconflicts.length && dmode !== 'additional') throw err('इस फ़ोन पर पुराना खाता मौजूद है। कृपया चुनें: पुराना खाता बदलें (उसका डेटा नए username में आएगा) या अलग दूसरा खाता बनाएँ।', 400, 'REPLACE_CHOICE_REQUIRED');
      var owner = findUserByUsername(dapp.desiredUsername);
      if (owner && target && owner.id === target.id) {
        owner.pwHash = dapp.pwHash; owner.recoveryHash = dapp.recoveryHash; owner.name = dapp.name;
        owner.accountStatus = 'active'; owner.tokens = {};
        if (!owner.devices) owner.devices = {};
        owner.devices[dapp.device] = Date.now(); db.deviceOwner[dapp.device] = owner.id;
        if (dapp.fp) db.fpOwner[dapp.fp] = owner.id;
        recordDeviceAccount(owner, dapp.device, dapp.fp || null);
        var adoptedSame = adoptGuestVotes(owner, dapp.device);
        dapp.status = 'approved'; dapp.decidedAt = Date.now(); dapp.decisionNote = dnote;
        dapp.resultingUserId = owner.id; dapp.replacedUserId = owner.id; dapp.pwHash = null; dapp.recoveryHash = null; save();
        return { ok: true, applicationId: dapp.id, status: 'approved', resultingUserId: owner.id, replacedUserId: owner.id, adoptedVotes: adoptedSame };
      }
      if (owner) throw err('माँगा गया username (@' + dapp.desiredUsername + ') इस बीच किसी खाते में लग चुका है — आवेदन अस्वीकार करके उपयोगकर्ता से नया username माँगें।', 409);
      var nu = {
        id: rid(8), name: dapp.name, nameLower: nameKey(dapp.name), username: dapp.desiredUsername,
        accountStatus: 'active', createdAt: Date.now(), appliedAt: dapp.createdAt, approvedFromApplication: dapp.id,
        lastLoginAt: null, isDemo: false, devices: {}, tokens: {}, pwHash: dapp.pwHash, recoveryHash: dapp.recoveryHash
      };
      db.users.push(nu);
      nu.devices[dapp.device] = Date.now(); db.deviceOwner[dapp.device] = nu.id;
      if (dapp.fp) db.fpOwner[dapp.fp] = nu.id;
      recordDeviceAccount(nu, dapp.device, dapp.fp || null);
      var dadopted = adoptGuestVotes(nu, dapp.device);
      if (target) mergeAccountInto(target, nu);
      dapp.status = 'approved'; dapp.decidedAt = Date.now(); dapp.decisionNote = dnote;
      dapp.resultingUserId = nu.id; dapp.replacedUserId = target ? target.id : null;
      dapp.pwHash = null; dapp.recoveryHash = null; save();
      return { ok: true, applicationId: dapp.id, status: 'approved', resultingUserId: nu.id, replacedUserId: dapp.replacedUserId, adoptedVotes: dadopted, username: nu.username };
    }

    if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'demo' && parts[3] === 'purge') {
      db.elections = db.elections.filter(function (e) { return !e.isDemo; });
      db.users = db.users.filter(function (u) { return !u.isDemo; });
      save();
      return { ok: true };
    }

    if (method === 'POST' && parts[1] === 'dev' && parts[2] === 'elections' && parts[4] === 'delete') {
      var idx = -1;
      db.elections.forEach(function (e, i2) { if (e.code === clean(parts[3], 16).toUpperCase()) idx = i2; });
      if (idx === -1) throw err('चुनाव नहीं मिला।', 404);
      db.elections.splice(idx, 1);
      save();
      return { ok: true };
    }

    throw err('API नहीं मिली।', 404);
  }

  window.JanmatOffline = {
    handle: handle,
    ensure: ensure,
    isActive: function () { return true; },
    reset: function () { db = seed(); save(); }
  };
})();
