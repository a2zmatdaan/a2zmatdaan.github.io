# 🛠️ जनमत (a2zmatdaan.github.io) — पूरी जाँच + फ़िक्स रिपोर्ट

**तारीख़:** 24 अक्टूबर 2026 · **साइट:** https://a2zmatdaan.github.io/ · **Repo:** `a2zmatdaan/a2zmatdaan.github.io`

---

## 1) असली समस्या क्या थी? (Root cause)

जब साइट खोली तो आया:

> **404 — File not found** · "For root URLs you must provide an `index.html` file."

Repo में सिर्फ़ ये था:

| फ़ाइल | स्थिति |
|---|---|
| `janmat-v2.zip` | ✅ मौजूद (445 KB) |
| `.github/workflows/1-setup.yml` | ✅ मौजूद |
| `index.html` | ❌ **नहीं था** |

यानी पूरा ऐप **ZIP के अंदर बंद** था। GitHub Pages सिर्फ़ `index.html` (या `README.md`) सर्व करता है — ZIP नहीं खोलता।
इसलिए होस्टिंग को देने के लिए कुछ था ही नहीं → 404।

### साथ में दो और चुपचाप पड़ी समस्याएँ

1. **Action भी fail हो रहा था।** `1-setup.yml` का काम था ZIP खोलकर प्रोजेक्ट root में लगाना, पर
   Run #40108746199 और #40108709149 — **दोनों का नतीजा `failure`**। यानी "कुछ मत करो, Action कर देगा" वाला तरीक़ा
   चल ही नहीं रहा था, इसलिए repo में कभी `index.html` बना ही नहीं।
2. **Build का आउटपुट host के लिए गलत जगह था।** `build.js` CSS + JS + फ़ॉन्ट को `index.html` में inline करता था
   (यानी single self-contained file बनाती थी), लेकिन उसे सिर्फ़ `public/index.html` में लिखता था —
   **root में कभी नहीं**। इसलिए GitHub Pages (branch = main, folder = `/root`) को फ़ाइल मिलती ही नहीं।

> छोटी बात: कोड की क्वालिटी अच्छी है — बैकएंड, फ़्रंटएंड, सुरक्षा, SSE, डार्क मोड सब काम कर रहा है।
> दिक्कत डिप्लॉयमेंट की थी, ऐप की नहीं। नीचे मैंने आसली सर्वर पर भी सब कुछ चलाकर जाँचा है।

---

## 2) क्या-क्या ठीक किया (14 फ़िक्स)

### 🔴 साइट को चालू करने वाले फ़िक्स

| # | फ़िक्स | फ़ाइल |
|---|---|---|
| 1 | **`index.html` root में बनने लगा** — अब `build.js` दोनों जगह लिखता है (`index.html` + `public/index.html`) | `build.js` |
| 2 | **`.nojekyll` जोड़ा** — GitHub Pages Jekyll से फ़ाइलें प्रोसेस/छिपाए नहीं | `.nojekyll` (नई) |
| 3 | **तैयार single-file `index.html`** repo root में रख दिया — CSS, JS, Devanagari फ़ॉन्ट सब अंदर, कोई external फ़ाइल नहीं | `index.html` (446 KB) |
| 4 | **पुराने external tags हटाए** — build के बाद `<link href="/styles.css">` और `<script src="/symbols.js">` अब अपने आप निकल जाते हैं (वरना हर लोड पर 404) | `build.js` |

### 🟠 स्टैटिक होस्टिंग (GitHub Pages) पर व्यवहार के फ़िक्स

| # | फ़िक्स | फ़ाइल |
|---|---|---|
| 5 | **एक ही बार सर्वर-प्रोब** — पेज खुलते ही `GET /api/health` से पता चलता है कि असली सर्वर है या नहीं; नहीं है तो ऐप सीधे **लोकल/प्रीव्यू मोड** में चलता है (पहले हर API call पर 404 + console errors की बारिश होती) | `offline.js`, `app.js` |
| 6 | **`sessionStorage` में याद** — दूसरी बार खोलने पर प्रोब भी नहीं होता, प्रीव्यू तुरंत खुलता है | `offline.js` |
| 7 | **6 सेकंड का timeout** — धीमे सर्वर (Render free plan जगने में ~50 सेकंड) को गलती से "offline" नहीं मानता | `offline.js` |
| 8 | **SSE/पोलिंग स्टैटिक मोड में बंद** — Live badge अब झूठा "लाइव" नहीं दिखाता, "लोकल" दिखता है | `app.js` |

### 🟡 दिखने/डिज़ाइन के फ़िक्स

| # | फ़िक्स | फ़ाइल |
|---|---|---|
| 9 | **बोल्ड हिंदी टेक्स्ट कटना** — variable फ़ॉन्ट 100–900 वेट सपोर्ट करता है, पर `@font-face` में `400 800` लिखा था। इसलिए `font-weight:800` वाला text (जैसे **"चालू"**) फ़ॉलबैक फ़ॉन्ट में जाकर कट/ओवरलैप हो रहा था → `100 900` किया | `styles.css` |
| 10 | **"चालू स्थिति" एक-दूसरे पर चढ़ रहा था** — baseline align → center + बड़ा गैप | `styles.css` |
| 11 | **डेवलपर पेज का नीला बैंड कटता था** — gradient प्रतिशत (30% / 18% / 26%) में था, इसलिए लैपटॉप और मोबाइल पर heading/stat cards के बीच से कट जाता था → अब हर ब्रेकपॉइंट पर fixed px बैंड | `styles.css` |

### 🟢 बाक़ी सफ़ाई

| # | फ़िक्स | फ़ाइल |
|---|---|---|
| 12 | CI स्क्रिप्ट को executable किया (`chmod +x`) — वरना smoke test चलता ही नहीं | `.github/scripts/*.sh` |
| 13 | `README.md` में v3 का सेक्शन जोड़ा (क्या टूटा था, कैसे ठीक है) | `README.md` |
| 14 | टेस्ट डेटा (`data/db.json`) पैकेज से हटाया — डेटाबेस बिलकुल खाली | `data/` |

---

## 3) मैंने कैसे जाँचा (Evidence)

| टेस्ट | नतीजा |
|---|---|
| `bash .github/scripts/smoke.sh` — असली सर्वर + 15 API चेक (लॉगिन → चुनाव → वोट → दोबारा वोट रुके → नाम न लीक → डेव पैनल → खाता हटाना) | ✅ **15/15 पास** |
| Browser E2E — **सर्वर मोड** (localhost:3000): होम → लॉगिन → चुनाव बनाना → वोट → परिणाम → डेव पैनल → सेटिंग्स → explore → terms/privacy/disclaimer → डार्क मोड | ✅ सब पास, **0 console errors** |
| Browser E2E — **स्टैटिक मोड** (GitHub Pages जैसा सर्वर, जो `/api/*` पर 404 देता है) | ✅ सब पास, सिर्फ़ 1 जान-बूझकर किया गया health-probe 404 |
| मोबाइल 390×844 (iPhone 13) — होम, चुनाव बनाना, डेवलपर, सेटिंग्स | ✅ horizontal scroll/overflow नहीं, layout ठीक |
| 1440 / 1280 / 980 / 760 / 390 px पर डेवलपर पेज | ✅ नीला बैंड अब कहीं नहीं कटता |

---

## 4) अब आपको क्या करना है (3 कदम, ~2 मिनट)

### ✅ कदम 1 — `index.html` upload करें
1. https://github.com/a2zmatdaan/a2zmatdaan.github.io खोलें
2. **Add file → Upload files**
3. `/home/user/janmat-fixed/index.html` (और `.nojekyll`) drag करें → **Commit changes**

> **सिर्फ़ `index.html` भी काफ़ी है** — वह पूरा self-contained है (डिज़ाइन, सारे पेज, चुनाव बनाना, वोट, डेवलपर पैनल सब अंदर)।
> बस साझा (multi-user) वोटिंग नहीं होगी — वह सर्वर वाली साइट पर होती है, नीचे कदम 3 देखें।

### ✅ कदम 2 — Pages चालू करें
**Settings → Pages → Source: *Deploy from a branch* → Branch: `main`, Folder: `/ (root)` → Save**
1–2 मिनट में https://a2zmatdaan.github.io/ live।

### ✅ कदम 3 (ज़रूरी नहीं, पर असली साझा वोटिंग के लिए) — Render पर सर्वर
स्टैटिक साइट हर ब्राउज़र की अलग-अलग होती है (डेटा उसी ब्राउज़र में)। **एक लिंक पर सब मिलकर वोट करें** इसके लिए:
1. `/home/user/janmat-fixed/` की सारी फ़ाइलें repo में upload करें (`server.js`, `package.json`, `public/`, `render.yaml`, …)
2. [render.com](https://render.com) → GitHub login → **New + → Blueprint** → यही repo → **Apply**
3. 2–3 मिनट में `https://janmat.onrender.com` live — डेवलपर पैनल `/#/developer`, पासवर्ड `KHOHDEEG`

### 🧹 सफ़ाई
- `janmat-v2.zip` repo से **delete** कर दें (अब ज़रूरत नहीं)।
- `.github/workflows/1-setup.yml` भी delete कर दें — यही Action fail हो रहा था (अब काम खुद हो चुका है)।

---

## 5) पैकेज में क्या है (`/home/user/janmat-fixed/`)

```
janmat-fixed/
├── index.html          ⭐ GitHub Pages के लिए तैयार single file (CSS+JS+फ़ॉन्ट inline)
├── .nojekyll           ⭐ Pages को Jekyll प्रोसेसिंग से रोकता है
├── server.js           असली बैकएंड (Node, zero dependency) — साझा वोटिंग के लिए
├── build.js            🔧 फ़िक्स किया: अब root + public दोनों में index.html बनाता है
├── package.json        npm start / npm run build
├── render.yaml         1-click Render deploy (Blueprint)
├── Dockerfile          किसी भी Docker होस्ट के लिए
├── README.md           डॉक्यूमेंटेशन (v3 सेक्शन जोड़ा)
├── public/             सोर्स: styles.css, app.js, offline.js, symbols.js, template.html, fonts/
├── .github/            workflows + smoke/setup स्क्रिप्ट
└── data/               खाली (कोई डेमो डेटा नहीं)
```

**Zip भी तैयार है:** `/home/user/janmat-v3-fixed.zip` (upload करने में आसान)

---

## 6) आगे क्या सुधार सकते हैं (ज़रूरी नहीं, बस सुझाव)

1. **Pages और Render दोनों साथ** रखें: Pages = डिज़ाइन/डेमो देखने के लिए, Render = असली साझा वोटिंग के लिए।
   (या Pages वाली साइट में `API_BASE = 'https://janmat.onrender.com'` डालकर दोनों को जोड़ा जा सकता है — बताइए तो कर दूँ।)
2. **डेवलपर पासवर्ड `KHOHDEEG`** repo में public है — बदलने के लिए Render में `DEV_PASSWORD` env variable सेट करें।
3. **डेटा स्थायी** रखने के लिए Upstash Redis जोड़ें (README में तरीक़ा है) — Render free plan पर फ़ाइल वाला डेटा रीस्टार्ट पर मिट सकता है।
4. "1 डिवाइस = 1 वोट" फ़िंगरप्रिंट ब्राउज़र-आधारित है — 100% सुरक्षा नहीं देता; असली सरकारी चुनाव के लिए यह मंच नहीं है (साइट पर डिस्क्लेमर भी है)।
