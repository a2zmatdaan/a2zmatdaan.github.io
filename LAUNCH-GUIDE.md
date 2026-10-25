# 🚀 जनमत — लॉन्च गाइड (सिर्फ़ 2 काम आपके, बाक़ी Action करेगा)

> भाई, इस बार सब कुछ अपने आप हो जाएगा। आपको कोई फ़ाइल edit नहीं करनी,
> कोई folder नहीं खोलना, कुछ build नहीं करना। बस नीचे के 2 काम कीजिए।

---

## 📦 जो चीज़ें आपको चाहिए

| फ़ाइल | काम |
|---|---|
| **`janmat-upload.zip`** | यही GitHub पर drag करना है (सब कुछ इसके अंदर है) |
| **`0-setup.yml`** | इसका टेक्स्ट copy करके GitHub में एक फ़ाइल बनानी है |

---

## ✅ काम 1 — ZIP upload करें (30 सेकंड)

1. GitHub पर अपनी repo खोलें: `a2zmatdaan.github.io`
2. **Add file → Upload files**
3. **`janmat-upload.zip`** को drag करें (सिर्फ़ यही एक फ़ाइल)
4. नीचे **Commit changes** दबाएँ

बस। अभी कुछ नहीं होगा — पहले Action चाहिए।

---

## ✅ काम 2 — Action को बताएँ (1 मिनट)

1. उसी repo में **Add file → Create new file**
2. नाम लिखें (ध्यान से, ठीक ऐसे ही):
   ```
   .github/workflows/0-setup.yml
   ```
3. नीचे बड़े खाने में **`0-setup.yml` फ़ाइल का पूरा टेक्स्ट paste** करें
4. **Commit changes** दबाएँ

---

## ⚙️ अब Action अपने आप ये सब करेगा (कोई काम नहीं, बस देखिए)

1. 🔓 ZIP खोलेगा और पूरा प्रोजेक्ट repo में लगा देगा (zip हट जाएगी)
2. 🏗️ `index.html` बनाएगा
3. 🧪 असली सर्वर चलाकर **15 tests** करेगा (लॉगिन → चुनाव → वोट → दोबारा वोट रुके → डेवलपर पैनल)
4. 💾 सब commit + push कर देगा
5. 🌐 **GitHub Pages अपने आप चालू करके साइट live कर देगा** (Settings में जाने की ज़रूरत नहीं)
6. 📋 ऊपर **summary** में आपकी साइट का पता + Render का one-click link दिखा देगा

देखने के लिए: repo में **Actions** टैब → **0 · Auto Setup** → हरा ✅ दिखना चाहिए।
पूरा होने में ~1–2 मिनट लगते हैं।

---

## 🗳️ अब असली साझा वोटिंग (Render — मुफ़्त, कार्ड नहीं)

Action ख़त्म होने पर summary में एक लिंक मिलेगा — ऐसा:

```
https://render.com/deploy?repo=https://github.com/a2zmatdaan/a2zmatdaan.github.io
```

1. उस लिंक को खोलें
2. **GitHub से login** करें
3. **Apply** दबाएँ (Render `render.yaml` से सब सेटिंग खुद ले लेगा)
4. 2–3 मिनट बाद ऊपर आपका URL दिखेगा, जैसे
   **`https://janmat-xxxx.onrender.com`** ← इसे copy कर लें

**अब यही आपकी असली साइट है** — इस लिंक पर जो भी जाएगा, वही चुनाव देखेगा, वही वोट करेगा।
कोई login-banner नहीं, कोई demo नहीं।

### 🔗 (एक कदम और — तभी github.io वाला पता भी काम करेगा)

repo में जाएँ → **Settings → Secrets and variables → Actions → Variables → New repository variable**

| Name | Value |
|---|---|
| `API_BASE` | `https://janmat-xxxx.onrender.com` (आपका Render URL) |

फिर **Actions → 0 · Auto Setup → Run workflow** दबाएँ (10 सेकंड में फिर deploy हो जाएगा)।

अब `https://a2zmatdaan.github.io` भी उसी साझा सर्वर से चलेगा — दोनों पते एक जैसे काम करेंगे।

---

## 🔑 डेवलपर पैनल (सिर्फ़ आपके लिए)

```
https://aapki-site/#/developer
```
पासवर्ड: **`KHOHDEEG`** (बदलना हो तो repo variable `DEV_PASSWORD` सेट कर दें)

वहाँ **"सिस्टम जाँच"** कार्ड में हर चीज़ का सच दिखता है:

- ✅ सर्वर जुड़ा है या नहीं
- ⚠️ डेटा रीस्टार्ट पर मिटेगा या नहीं (Upstash जोड़ने की सलाह)
- ✅ खोजकर आने वाले लोग चुनाव देख पा रहे हैं या नहीं
- ✅ अभी कितने असली चुनाव live हैं
- ✅ कोई डेमो/नक़ली डेटा नहीं

---

## 💾 ज़रूरी: डेटा हमेशा बचा रहे (5 मिनट, मुफ़्त)

Render का free plan restart पर फ़ाइल वाला डेटा मिटा सकता है। इसलिए:

1. [upstash.com](https://upstash.com) → **Sign up** (मुफ़्त) → **Create Database** → Redis चुनें
2. Database में **REST API** टैब → दो चीज़ें copy करें
3. Render → अपनी service → **Environment** → दो variables जोड़ें:

```
UPSTASH_REDIS_REST_URL   = https://xxxx.upstash.io
UPSTASH_REDIS_REST_TOKEN = AX...
```

4. **Save** — अब हर चुनाव और हर वोट **स्थायी** रहेगा।

---

## 🔔 (ज़रूरी नहीं) Render को जगाए रखना

Render free 15 मिनट बाद सो जाता है (पहली visit पर ~50 सेकंड)। पहले से मौजूद
`.github/workflows/2-keepalive.yml` इसे हर 14 मिनट में जगाता रहेगा — बस एक variable जोड़ें:

| Name | Value |
|---|---|
| `SITE_URL` | `https://janmat-xxxx.onrender.com` |

---

## 😟 कुछ गड़बड़ हो तो?

| दिक्कत | कारण / हल |
|---|---|
| Actions में ❌ लाल | **Actions → 0 · Auto Setup** खोलें → जो step लाल है उसका log देखें। सबसे आम: zip upload नहीं हुई या गलत नाम से workflow बना |
| साइट पर 404 | Action पूरा होने दें (1–2 मिनट), फिर page refresh करें |
| साइट खुली पर ऊपर पीली पट्टी "डेमो प्रीव्यू" | `API_BASE` variable नहीं डाला — ऊपर वाला कदम करें |
| दूसरों को चुनाव नहीं दिख रहा | वही बात — `API_BASE` (या Render URL) से साइट जुड़ी होनी चाहिए; डेवलपर पैनल की "सिस्टम जाँच" में पहली लाइन हरी होनी चाहिए |
| Render पर पहली बार धीमा | ~50 सेकंड — सोया हुआ है, जाग रहा है। keep-alive variable डाल दें |

---

**संक्षेप:** ZIP upload → workflow paste → Action सब कर देगा → Render में Apply।
उसके बाद आपकी साइट असली, साझा, बिना डेमो — और लोग **खोजकर भी** आपका चुनाव पा लेंगे। 🎉
