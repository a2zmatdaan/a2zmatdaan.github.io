# 🔧 अब असली कारण मिल गया — मेरी गलती थी

## पहले: माफ़ी 🙏

पिछली बार मैंने जो फ़ाइल दी, उसमें एक **गलत permission** लिख दी थी। उसकी वजह से GitHub ने
पूरी workflow फ़ाइल को **अमान्य (invalid)** मान लिया और तुरंत fail कर दिया — कोई step चला ही नहीं।

### कैसे पकड़ा

1. आपके repo से नई workflow फ़ाइल डाउनलोड की → वो ठीक paste हुई थी (बिल्कुल सही, आपकी कोई गलती नहीं)
2. रन का नाम `.github/workflows/0-setup.yml` दिख रहा था — यह GitHub का signal है कि **फ़ाइल अमान्य है**
3. **`actionlint`** (GitHub Actions का असली official linter) चलाया, और यह मिला:

```
wf.yml:26:3: unknown permission scope "workflows".
   |   workflows: write
   |   ^~~~~~~~~~
```

**GitHub में `workflows: write` नाम की कोई permission ही नहीं होती।**
इसीलिए पूरी फ़ाइल रद्द हो गई। अब वो लाइन हटा दी है — और `actionlint` अब **0 error** देता है ✅

> नोट: असली दिक्कत (जो पहली बार push रोक रही थी) वो अलग थी — commit में
> `.github/workflows` फ़ाइल भी जा रही थी। उसका हल पहले से है: **commit में workflow
> फ़ाइल को शामिल ही नहीं किया जाता**। इसलिए अब उस permission की ज़रूरत ही नहीं।

---

## ✅ अब बस यह कीजिए (2 मिनट) — पिछली बार की तरह ही

1. GitHub repo खोलें → **`.github/workflows/0-setup.yml`** → **✏️ Edit**
2. **Ctrl+A** (सब चुनें) → **Delete**
3. नई फ़ाइल **`0-setup.yml`** का **पूरा कंटेंट** paste करें
4. **Commit changes**

Commit करते ही Action अपने आप चलेगा।
अगर न चले → **Actions → 0 · Auto Setup → Run workflow**

---

## 🔍 अब सही चलेगा — क्यों (जो जाँचा गया)

| जाँच | नतीजा |
|---|---|
| `actionlint` (official GitHub linter) — दोनों workflow फ़ाइलें | ✅ **0 errors** |
| आपके repo जैसा setup (टूटी workflow + zip) → असली git remote पर पूरा Action | ✅ **28 फ़ाइलें repo में push हुईं** |
| आपकी workflow फ़ाइल सुरक्षित रही? | ✅ बिल्कुल नहीं छुई गई |
| ZIP खोलना (nested/root/दो zip/junk zip) | ✅ सब सही |
| Build + 15 smoke tests | ✅ **15/15 pass** |
| दूसरा run (कोई फ़र्ज़ी commit नहीं) | ✅ "कुछ बदलने की ज़रूरत नहीं" |
| `_site` और `.github/workflows` commit से बाहर | ✅ |

---

## 📋 Action के steps — अब ये सब होंगे

1. 📦 ZIP खोलकर प्रोजेक्ट root में लगाओ
2. 🛡️ workflow फ़ाइलें सुरक्षित रखो
3. 🏗️ Build (index.html) + Render URL inject
4. 🧪 Smoke test — 15 checks
5. 📁 Pages के लिए deploy फ़ोल्डर
6. ⬆️ Pages artifact
7. 💾 Commit + push *(fail हो तो भी साइट live होगी)*
8. 🚀 GitHub Pages deploy
9. 📋 Summary — आपकी साइट का पता + Render का link

---

## 🚑 अगर step 7 (commit + push) फिर भी लाल हो

तो यह repo की एक setting है (नई repos में डिफ़ॉल्ट read-only):

**Settings → Actions → General → Workflow permissions**
→ **"Read and write permissions"** चुनें → **Save**
→ **Actions → 0 · Auto Setup → Run workflow**

साथ ही उस run के नीचे **Artifacts → `janmat-project`** से पूरा प्रोजेक्ट zip मिल जाएगा —
उसे repo में upload कर देने से भी सब चल पड़ेगा।

> याद रखें: step 8 (Pages deploy) push पर निर्भर नहीं है — इसलिए **साइट फिर भी live हो जाएगी**।
> push सिर्फ़ Render के लिए ज़रूरी है (ताकि repo में `server.js`, `render.yaml` आ जाएँ)।

---

## 🗳️ फिर Render (असली साझा वोटिंग)

Summary में मिले लिंक से:

```
https://render.com/deploy?repo=https://github.com/a2zmatdaan/a2zmatdaan.github.io
```

→ **GitHub से login** → **Apply** → 2–3 मिनट में URL
(जैसे `https://janmat-xxxx.onrender.com`)

फिर **Settings → Secrets and variables → Actions → Variables → New variable**:

| Name | Value |
|---|---|
| `API_BASE` | `https://janmat-xxxx.onrender.com` |
| `SITE_URL` | वही URL (जगाए रखने के लिए, ज़रूरी नहीं) |

और **Actions → 0 · Auto Setup → Run workflow** एक बार फिर।

अब `https://a2zmatdaan.github.io` भी उसी साझा सर्वर से चलेगी — **सबको एक ही चुनाव दिखेगा, कोई डेमो नहीं** ✅
