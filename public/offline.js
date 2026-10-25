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
    return { version: 3, createdAt: Date.now(), users: [], elections: [], devSessions: {} };
  }

  /* ---------------------------- storage ---------------------------- */
  function load() {
    if (db) return;
    try {
      var raw = localStorage.getItem(DB_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 3) { db = parsed; return; }
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
  function summary(e) {
    var t = tally(e);
    return {
      code: e.code, title: e.title, type: e.type, gram: e.gram, district: e.district, state: e.state,
      createdAt: e.createdAt, closed: !!e.closed, closedAt: e.closedAt || null, demo: !!e.isDemo,
      totalVotes: t.totalVotes, candidateCount: e.candidates.length,
      symbols: e.candidates.slice(0, 5).map(function (c) { return c.symbol || 'diya'; })
    };
  }
  function full(e, viewer) {
    var t = tally(e);
    var my = viewer && e.votes[viewer.id] ? e.votes[viewer.id].c : null;
    var out = summary(e);
    out.candidates = e.candidates.map(function (c) { return { id: c.id, name: c.name, party: c.party || '', symbol: c.symbol || 'diya' }; });
    out.results = t;
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
  function pubUser(u) { return { id: u.id, name: u.name, createdAt: u.createdAt }; }
  function findElection(code) {
    var c = clean(code, 16).toUpperCase();
    for (var i = 0; i < db.elections.length; i++) if (db.elections[i].code === c) return db.elections[i];
    return null;
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
      if (token && db.users[i].tokens && db.users[i].tokens[token]) { viewer = db.users[i]; break; }
    }
    var devToken = clean(headers['x-dev-token'] || '', 80);
    var devOk = !!(devToken && db.devSessions[devToken] && db.devSessions[devToken].expiresAt > Date.now());

    var device = clean(body.deviceId || headers['x-device-id'] || '', 80);
    var deviceKey = device ? 'd:' + device.slice(0, 40) : 'local-preview';

    /* stats */
    if (method === 'GET' && parts[1] === 'stats') {
      var votes = 0;
      var states = {};
      db.elections.forEach(function (e) {
        votes += Object.keys(e.votes || {}).length;
        if (e.state) states[e.state] = 1;
      });
      return {
        elections: db.elections.length, votes: votes, states: Object.keys(states).length,
        candidates: db.elections.reduce(function (a, e) { return a + e.candidates.length; }, 0),
        users: db.users.filter(function (u) { return !u.isDemo; }).length,
        dailyLimit: DAILY_LIMIT
      };
    }

    /* auth */
    if (method === 'POST' && parts[1] === 'auth' && parts[2] === 'login') {
      var name = clean(body.name, 30);
      if (!name) throw err('अपना नाम लिखें।');
      if (name.length < 2) throw err('नाम कम से कम 2 अक्षरों का होना चाहिए।');
      if (!/^[\p{L}\p{M}\p{N} .'_-]+$/u.test(name)) throw err('नाम में सिर्फ़ अक्षर, अंक, स्पेस और . \' _ - चलेंगे।');
      if (['developer', 'dev', 'admin', 'administrator', 'janmat', 'moderator', 'root'].indexOf(nameKey(name)) !== -1) {
        throw err('यह नाम आरक्षित है, कृपया दूसरा नाम चुनें।');
      }
      var user = null;
      for (var j = 0; j < db.users.length; j++) if (db.users[j].nameLower === nameKey(name)) { user = db.users[j]; break; }
      if (!user) {
        user = { id: rid(8), name: name, nameLower: nameKey(name), createdAt: Date.now(), lastLoginAt: Date.now(), isDemo: false, devices: {}, tokens: {} };
        db.users.push(user);
      } else {
        user.lastLoginAt = Date.now();
        user.name = name;
      }
      user.devices[deviceKey] = Date.now();
      var tk = rid(24);
      user.tokens[tk] = Date.now();
      save();
      return { user: pubUser(user), token: tk, quota: quotaFor(user) };
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
      var st = {};
      db.elections.forEach(function (e) { if (e.state) st[e.state] = 1; });
      return { elections: list.map(summary), states: Object.keys(st).sort() };
    }

    /* elections create */
    if (method === 'POST' && parts[1] === 'elections' && parts.length === 2) {
      if (!viewer) throw err('चुनाव बनाने के लिए पहले नाम से लॉगिन करें।', 401, 'LOGIN_REQUIRED');
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

    if (method === 'GET' && election && parts.length === 3) return full(election, viewer);

    if (method === 'POST' && election && parts[3] === 'vote') {
      if (!viewer) throw err('वोट देने के लिए पहले अपना नाम लिखकर लॉगिन करें।', 401, 'LOGIN_REQUIRED');
      if (election.closed) throw err('यह चुनाव समाप्त हो चुका है, अब वोट नहीं डाला जा सकता।', 403);
      var candidateId = clean(body.candidateId, 40);
      var cand = null;
      election.candidates.forEach(function (c) { if (c.id === candidateId) cand = c; });
      if (!cand) throw err('उम्मीदवार नहीं मिला।');
      if (election.votes[viewer.id]) throw err('आप इस चुनाव में पहले ही वोट कर चुके हैं।', 409, 'ALREADY_VOTED', { election: full(election, viewer) });
      if (election.devices[deviceKey]) {
        throw err('इस फ़ोन/डिवाइस से इस चुनाव में वोट दिया जा चुका है। एक डिवाइस से सिर्फ़ एक ही वोट मान्य है।', 409, 'DEVICE_VOTED', { election: full(election, viewer) });
      }
      election.votes[viewer.id] = { c: cand.id, at: Date.now(), device: deviceKey };
      election.devices[deviceKey] = { userId: viewer.id, at: Date.now() };
      save();
      return { ok: true, votedFor: { id: cand.id, name: cand.name, symbol: cand.symbol }, election: full(election, viewer) };
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
          s.leading = tt.candidates[0] || null;
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
        var created = db.elections.filter(function (e) { return e.creatorId === u.id; });
        var voted = db.elections.filter(function (e) { return e.votes[u.id]; });
        return {
          id: u.id, name: u.name, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, isDemo: !!u.isDemo,
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
          creatorId: e.creatorId, creatorName: cr ? cr.name : 'अज्ञात', creatorIsDemo: cr ? !!cr.isDemo : false,
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
            at: (v && v.at) || 0, userId: uid, userName: u ? u.name : 'अज्ञात उपयोगकर्ता', userIsDemo: u ? !!u.isDemo : true,
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
        users: users, elections: elections, votes: voteRows.slice(0, 1000)
      };
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
          at: (v && v.at) || 0, userName: u ? u.name : 'अज्ञात', userIsDemo: u ? !!u.isDemo : true,
          candidateName: c ? c.name : '—', candidateSymbol: c ? c.symbol || 'diya' : 'diya',
          deviceShort: v && v.device ? String(v.device).slice(0, 10) : ''
        };
      }).sort(function (a, b) { return b.at - a.at; });
      var outE = full(e2, null);
      outE.creatorName = creator ? creator.name : 'अज्ञात';
      outE.creatorId = e2.creatorId;
      return { election: outE, votes: rows };
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
