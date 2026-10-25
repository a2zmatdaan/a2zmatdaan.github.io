# ✅ साइट LIVE है — अब बस 3 कदम

## 🎉 जो हो गया (आज 00:48)

| चीज़ | स्थिति |
|---|---|
| GitHub Action | ✅ **पूरा success** — 10/10 steps हरे |
| ZIP खुली + प्रोजेक्ट repo में | ✅ 28 फ़ाइलें (`server.js`, `public/`, `render.yaml` सब) |
| Build (index.html) | ✅ |
| 15 smoke tests | ✅ **15/15 पास** |
| Commit + push | ✅ (permissions का झंझट खत्म) |
| **GitHub Pages deploy** | ✅ **साइट live** |
| असली पता | 🌐 **https://a2zmatdaan.github.io** |

बनाकर जाँचा (असली साइट पर):

```
होम          ✅   चुनाव खोजें   ✅   कैसे काम करता है  ✅
सेटिंग्स      ✅   नियम          ✅   गोपनीयता        ✅
डिस्क्लेमर    ✅   डेवलपर         ✅   चुनाव बनाना      ✅
चुनाव बनाया  ✅  (preview mode में)   Console errors  ✅ शून्य
मोबाइल 390px  ✅   कोई overflow नहीं
```

---

## ⚠️ अभी एक बात समझ लें (ज़रूरी)

अभी साइट **preview mode** में है — ऊपर पीली पट्टी दिखती है:
> *"डेमो प्रीव्यू — यह पेज सिर्फ़ आपके ब्राउज़र में सेव होता है…"*

मतलब: जो भी चुनाव बनेगा वो **सिर्फ़ उसी ब्राउज़र** में रहेगा। **अभी लोगों को लिंक बाँटकर वोटिंग न कराएँ।**
इसे असली (साझा) बनाने के लिए सिर्फ़ एक सर्वर चाहिए — वो नीचे 3 कदम में चालू होगा।

---

## 👉 कदम 1 — Render पर सर्वर (3 क्लिक, मुफ़्त, कार्ड नहीं)

### 1) यह लिंक खोलें
```
https://render.com/deploy?repo=https://github.com/a2zmatdaan/a2zmatdaan.github.io
```

### 2) **GitHub** से login करें (नया account, ईमेल से भी हो सकता है)

### 3) **Apply** दबाएँ
- Render `render.yaml` खुद पढ़ लेगा — कुछ भरना नहीं है
- नाम `janmat`, region Singapore, plan Free — सब पहले से सेट
- **2–3 मिनट** में ऊपर आपका URL दिखेगा:

```
https://janmat-xxxx.onrender.com        ← इसे कॉपी कर लें
```

> पहली बार खोलने पर ~50 सेकंड लग सकते हैं (free plan सोया रहता है) — घबराएँ नहीं।
> अगर Render कार्ड माँगे तो **Free** plan ही चुनें — कार्ड नहीं चाहिए।

**✅ जाँच:** उस URL को खोलें — साइट बिना पीली पट्टी के खुलेगी। यही आपकी **असली साइट** है।

---

## 👉 कदम 2 — github.io को उस सर्वर से जोड़ें (1 मिनट)

repo में जाएँ → **Settings → Secrets and variables → Actions → Variables → New repository variable**

| Name | Value |
|---|---|
| `API_BASE` | `https://janmat-xxxx.onrender.com` *(आपका Render URL — आख़िर में `/` नहीं)* |

फिर **Actions → 0 · Auto Setup → Run workflow** दबाएँ (10 सेकंड का काम)।

अब `https://a2zmatdaan.github.io` भी उसी सर्वर से चलेगी — **पीली पट्टी गायब** हो जाएगी।

---

## 👉 कदम 3 — डेटा हमेशा बचा रहे (5 मिनट, मुफ़्त, सबसे ज़रूरी)

Render free plan restart पर फ़ाइल वाला डेटा मिटा सकता है। इसलिए:

1. [upstash.com](https://upstash.com) → **Sign up** → **Create Database** → **Redis** (Free)
2. Database → **REST API** टैब → दो चीज़ें copy करें
3. Render → अपनी service → **Environment** → दो variables:

```
UPSTASH_REDIS_REST_URL   = https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN = AX...
```

4. **Save** — अब हर चुनाव/वोट **स्थायी** रहेगा।

> यह ध्यान से करें — वरना किसी दिन चुनाव "गायब" हो सकता है और लोग नाराज़ होंगे।

---

## 🔔 (ज़रूरी नहीं) Render को जगाए रखना

**Settings → Variables → New variable**: `SITE_URL` = आपका Render URL
→ हर 14 मिनट में अपने आप जगता रहेगा (`.github/workflows/2-keepalive.yml`)

> ध्यान: `2-keepalive.yml` अभी repo में नहीं है (zip के अंदर था, Action ने workflow फ़ाइलें
> जान-बूझकर नहीं बदलीं)। चाहें तो यह बाद में जोड़ सकते हैं — पहले बाक़ी सब चालू कर लें।

---

## 🔑 डेवलपर पैनल (सिर्फ़ आपके लिए)

```
https://aapka-render-url/#/developer        या        https://a2zmatdaan.github.io/#/developer
```
पासवर्ड: **`<Render Dashboard में सेट करें>`**

वहाँ **"सिस्टम जाँच"** कार्ड में सब सच दिखेगा:
- ✅ सर्वर जुड़ा है → हरा होना चाहिए
- ⚠️ डेटा फ़ाइल में है → Upstash जोड़ें (कदम 3)
- ✅ खोजकर आने वाले भी चुनाव देख सकते हैं
- ✅ अभी कितने असली चुनाव live हैं

**पासवर्ड बदलना हो:** Render → Environment → `DEV_PASSWORD` बदल दें।

---

## ✅ सब हो जाने के बाद ऐसे जाँचें (2 मिनट)

1. अपने फ़ोन से एक चुनाव बनाएँ (`नीमगाँव — सरपंच चुनाव`)
2. **दूसरे फ़ोन/लैपटॉप** (या incognito) से `https://aapka-render-url/#/explore` खोलें
3. वहाँ **आपका चुनाव दिखना चाहिए** — बिना किसी लिंक के, सिर्फ़ खोजकर
4. उससे वोट करें → आपके पहले फ़ोन पर **बिना रीलोड वोट बढ़ जाना चाहिए**

तीनों ✅ = आपका सपना पूरा 🎉 — असली लोग, असली वोट, कोई डेमो नहीं।

---

## 😟 कुछ अटके तो

| दिक्कत | हल |
|---|---|
| Render ने कार्ड माँगा | **Free** plan चुनें; Blueprint में पहले से free है |
| Render URL नहीं मिला | Render dashboard → **janmat** service → ऊपर URL |
| github.io पर अभी भी पीली पट्टी | `API_BASE` variable डालने के बाद **Run workflow** दबाया? |
| पहली visit पर 50 सेकंड | सोया हुआ है — `SITE_URL` variable डालकर keep-alive चालू करें |
| चुनाव गायब हो गया | Upstash Redis नहीं जोड़ा — कदम 3 करें |
| दूसरे को नहीं दिख रहा | वो **Render URL** खोल रहा है या पुराना github.io लिंक? दोनों एक ही सर्वर पर होने चाहिए |
