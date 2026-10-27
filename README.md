# 🗳️ जनमत (Janmat) — ऑनलाइन मतदान मंच v8

> ## 🆔 v8 — अनोखा Username + गुप्त PIN
>
> अब दिखने वाला असली नाम कई लोगों का एक जैसा हो सकता है, लेकिन login पहचान **पूरी site पर अनोखा username + 6–10 अंकों का PIN** है। लिया हुआ username साफ़ “पहले से उपयोग में है” कहेगा। Guest वोट चालू है; उसी फ़ोन से बाद में signup करने पर Guest वोट खाते से जुड़ेगा और Developer Panel में “पहले Guest, बाद में signup” दिखेगा। एक फ़ोन से एक सीधा खाता बनेगा; दूसरा खाता या भूला username Team Janmat के manual आवेदन से मिलेगा।
>
> **पूरी जानकारी और deploy तरीका: `V8-USERNAME-GUIDE.md` देखें।** इस README के पुराने ऐतिहासिक हिस्सों में जहाँ “सिर्फ़ नाम से लॉगिन” जैसी बात दिखे, वह v8 में बदल चुकी है।


> ## ⚡ v3 — GitHub Pages वाला 404 ठीक हो गया (24 Oct 2026)
>
> **समस्या:** repo में सिर्फ़ `janmat-v2.zip` था, कोई `index.html` नहीं — इसलिए
> `https://a2zmatdaan.github.io/` पर **404** आ रहा था।
>
> **अब:** root में तैयार **`index.html`** (single file, CSS + JS + फ़ॉन्ट सब अंदर) रखा है।
> बस इसे upload करके **Settings → Pages → Branch: main / (root)** कर दें — साइट तुरंत live।
> `.nojekyll` भी शामिल है ताकि GitHub Pages फ़ाइलों को छेड़े नहीं।
>
> पूरी जानकारी: **FIX-REPORT.md** देखें।
>
> ## 🔴 “दूसरे लोगों को मेरा चुनाव नहीं दिख रहा” — इसका हल
> GitHub Pages पर सर्वर नहीं होता, इसलिए डेटा हर ब्राउज़र में अलग रहता है।
> **हल:** Render पर सर्वर चालू करें और `config.js` में उसका URL डाल दें —
> फिर आपकी github.io साइट भी साझा (सबको दिखने वाला) डेटा इस्तेमाल करेगी।
> **पूरा तरीक़ा: `SHARED-VOTING.md` देखें (5 मिनट)।**


एक **professional, multi-user** ऑनलाइन चुनाव मंच — कोई npm dependency नहीं, सिर्फ़ Node.js।
कोई भी अपना चुनाव बना सकता है (सरपंच, प्रधान, मुखिया, अध्यक्ष, MLA...) और दुनिया में कहीं से भी लोग वोट कर सकते हैं।

## 🚀 सबसे आसान तरीक़ा — "कुछ मत करो, Action कर देगा"

**3 कदम, सब ब्राउज़र में, कोई terminal नहीं।**

### कदम 1 — GitHub repo बनाओ
[github.com/new](https://github.com/new) → नाम **`janmat`** → **Public** → *Create repository*

### कदम 2 — ZIP upload करो
Repo में **Add file → Upload files** → `janmat-v2.zip` drag → **Commit changes**

### कदम 3 — एक छोटी फ़ाइल paste करो (30 सेकंड)
**Add file → Create new file** → नाम लिखो:
```
.github/workflows/1-setup.yml
```
नीचे दिया ब्लॉक copy-paste करके **Commit changes** दबाओ:

```yaml
name: setup
on:
  push:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - shell: bash
        run: |
          set -euo pipefail
          shopt -s nullglob
          z=( *.zip )
          if [ ${#z[@]} -gt 0 ]; then
            rm -rf /tmp/jx && mkdir -p /tmp/jx
            unzip -q "${z[0]}" -d /tmp/jx
            f="$(find /tmp/jx -maxdepth 4 -name server.js | head -n 1)"
            d="$(dirname "$f")"
            shopt -s dotglob; cp -R "$d"/. .; shopt -u dotglob
            rm -f "${z[0]}"
          fi
      - shell: bash
        env: { DEV_PASSWORD: <Render Dashboard में सेट करें> }
        run: bash .github/scripts/setup.sh
```

### ✅ बस — अब Action खुद:
1. ZIP खोलेगा और प्रोजेक्ट root में लगा देगा (ZIP हट जाएगी)
2. `index.html` build करेगा
3. असली सर्वर चलाकर **15 smoke tests** करेगा (login → चुनाव → वोट → दोबारा वोट रुके → dev panel → खाता हटाना)
4. सब पास होने पर खुद commit + push करेगा
5. Actions tab में **Render का one-click link** दिखा देगा

फिर वही link खोलो → **Render में GitHub से login** (कार्ड नहीं चाहिए) → **Apply** → 2–3 मिनट में site live: `https://<naam>.onrender.com`

> `render.yaml` में सब कुछ पहले से भरा है (पासवर्ड, लिमिट, region, health check) — Render कुछ भी पूछेगा नहीं, सिर्फ़ **Apply**।

> दोबारा कुछ नहीं करना — हर `git push` पर Render खुद नया version deploy करता है (`autoDeploy: true`)।
> Render का free plan 15 मिनट बाद सो जाता है; जगाए रखने के लिए `.github/workflows/2-keepalive.yml` पहले से मौजूद है (README में नीचे देखें)।

---

## 🆕 v2.1 में क्या नया (इस बार जोड़ा गया)

- **कोई फ़ेक/डेमो डेटा नहीं** — साइट खाली डेटाबेस से शुरू होती है; जो असली लोग चुनाव बनाएँगे वही दिखेगा।
- **डेवलपर में लाइव फ़ीड (SSE)** — किसने किसको वोट दिया, वोट पड़ते ही उसी सेकंड डैशबोर्ड पर; स्टैट और तालिकाएँ भी अपने आप अपडेट।
- **डार्क मोड** — नेवबार में एक टैप, या लाइट/डार्क/सिस्टम में से चुनें।
- **सेटिंग्स का नया पूरा हिस्सा** — 10 अलग बटन: प्रोफ़ाइल, मेरे चुनाव, मेरे वोट, दिखावट/डार्क मोड, गाइड, नियम व शर्तें, गोपनीयता, डिस्क्लेमर, डेवलपर, खाता।
- **नियम व शर्तें व गोपनीयता नीति** के पूरे पेज (हिंदी में)।
- **खाता हटाने** की सुविधा — नाम मिटता है, वोट की गिनती बची रहती है।
- **चुनाव पेज लाइव** — रीलोड के बिना वोट संख्या/प्रतिशत बदलता है।

---

## ⚡ जल्दी शुरू करें (local)

```bash
cd janmat
node server.js
```
ब्राउज़र में खोलें → **http://localhost:3000**

> ज़रूरत सिर्फ़ Node.js 18+ है। `npm install` की ज़रूरत नहीं।

---

## 🔑 पासवर्ड व डिफ़ॉल्ट सेटिंग्स

| चीज़ | डिफ़ॉल्ट | कहाँ बदलें |
|---|---|---|
| **डेवलपर पासवर्ड** | `<Render Dashboard में सेट करें>` | `DEV_PASSWORD` env variable |
| **प्रति यूज़र रोज़ चुनाव सीमा** | `2` | `DAILY_ELECTION_LIMIT` env variable |
| **डेवलपर पेज** | `/#/developer` | — |
| **पोर्ट** | `3000` | `PORT` |
| **डेमो डेटा** | बंद (खाली DB) | `SEED_DEMO=1` — सिर्फ़ टेस्टिंग के लिए, असली साइट पर नहीं |

पासवर्ड बदलने का तरीका (Linux/Mac):
```bash
DEV_PASSWORD="MeraNayaPassword" node server.js
```

---

## ✅ सारे फ़ीचर्स (जो आपने माँगे)

| # | फ़ीचर | कैसे काम करता है |
|---|---|---|
| 1 | **Username + PIN लॉगिन** | असली नाम कई लोगों का एक जैसा हो सकता है; login के लिए पूरी site पर अनोखा username और 6–10 अंकों का PIN चाहिए। कोई mobile/Gmail/OTP नहीं। |
| 2 | **जुड़ी मोबाइल पहचान = 1 गिना वोट** | डिवाइस फिंगरप्रिंट + server संकेत। Guest या खाते से पड़ा पहला वोट गिना जाता है; उसी जुड़ी पहचान से दूसरा गिना वोट रुकता है और बाद के signup से Guest वोट खाते में जुड़ता है। |
| 3 | **1 यूज़र = रोज़ 2 चुनाव** | IST कैलेंडर दिन के हिसाब से। तीसरा चुनाव बनाने पर साफ़ संदेश + रीसेट का समय। |
| 4 | **सिर्फ़ आप (डेवलपर) सब देख सकते हैं** | `/#/developer` → पासवर्ड `<Render Dashboard में सेट करें>` → हर यूज़र, उसके बनाए चुनाव, और **किसने किसको वोट दिया** — सब। |
| 5 | **चुनाव बनाने वाला भी मतदाता नहीं देख सकता** | Public API में creator/voter की कोई जानकारी नहीं जाती (test की गई है)। आयोजक को सिर्फ़ गिनती + "बंद करें" बटन दिखता है। |
| 6 | **परिणाम मतदान के बाद** | मतदान के दौरान SSE से केवल कुल वोट संख्या अपडेट होती है; उम्मीदवारों की चलती गिनती केवल डेवलपर देख सकता है। चुनाव बंद होते ही अंतिम परिणाम सभी के लिए खुलता है। |
| 7 | **परिणाम हमेशा सुरक्षित** | वोट/चुनाव server पर सेव। Upstash Redis जोड़ते ही होस्टिंग रीस्टार्ट पर भी डेटा बचा रहता है। |
| 8 | **डिस्क्लेमर** | होम, फुटर, चुनाव पेज और पूरा `#/disclaimer` — कि यह गैर-सरकारी मंच है, कोई सरकारी/निर्वाचन-आयोग संबंध नहीं, ज़िम्मेदारी सीमित। |
| 9 | **डेवलपर में LIVE फ़ीड** | डैशबोर्ड खुला छोड़ दें — जो भी वोट पड़ेगा, **उसी सेकंड** ऊपर लाइव फ़ीड में दिखेगा: किसने, किस चुनाव में, किसको, कुल कितने। स्टैट/तालिकाएँ भी अपने आप रीफ़्रेश होती हैं। |
| 10 | **डार्क मोड** | नेवबार के ☀️ बटन से एक टैप में, या सेटिंग्स → दिखावट से लाइट/डार्क/सिस्टम। पसंद ब्राउज़र में याद रहती है; सिस्टम थीम पर फ़ोन के साथ अपने आप बदलती है। |
| 11 | **सेटिंग्स में सब कुछ** | प्रोफ़ाइल, मेरे चुनाव, मेरे वोट, डार्क मोड, गाइड, नियम व शर्तें, गोपनीयता नीति, डिस्क्लेमर, डेवलपर और खाता — हर एक अलग बटन। |
| 12 | **नियम व शर्तें + गोपनीयता नीति** | पूरे पेज (`/#/terms`, `/#/privacy`) — कौन-सा डेटा लिया जाता है, किसको दिखता है, कितने समय रहता है, आपके अधिकार। |
| 13 | **खाता हटाना** | सेटिंग्स → खाता → एक क्लिक में। नाम/पहचान मिट जाती है, पर वोटों की गिनती बरकरार रहती है ताकि परिणाम न बदलें। |
| 14 | **कोई डेमो/फ़ेक डेटा नहीं** | साइट खाली डेटाबेस से शुरू होती है। न होम पर नक़ली चुनाव, न डेमो यूज़र — सिर्फ़ असली लोग और असली वोट। |

---

## 🗂️ फ़ाइलें

```
janmat/
├── server.js            # पूरा बैकएंड (Node core, zero dependency)
├── build.js             # CSS/JS/font → index.html (single-file build)
├── package.json         # npm start / npm run build
├── render.yaml          # Render Blueprint (1-click deploy)
├── Dockerfile           # किसी भी Docker होस्ट के लिए
├── data/db.json         # डेटा (पहली बार अपने आप बनता है)
└── public/
    ├── index.html       # ⭐ built single-file site
    ├── template.html    # HTML खाका
    ├── styles.css       # डिज़ाइन
    ├── app.js           # फ्रंटएंड
    ├── symbols.js       # 24 चुनाव चिन्ह (SVG)
    ├── offline.js       # प्रीव्यू मोड (सर्वर बिना भी चले)
    └── fonts/           # Devanagari फ़ॉन्ट
```

**कोई बदलाव करने के बाद:**
```bash
node build.js     # फिर से public/index.html बनेगा
```

---

## 👀 सर्वर के बिना प्रीव्यू

`public/index.html` self-contained है — डबल-क्लिक करके खोलिए, पूरा डिज़ाइन दिखेगा (ऊपर पीली "डेमो प्रीव्यू" पट्टी के साथ, डेटा सिर्फ़ उसी ब्राउज़र में सेव होगा)। **वहाँ भी कोई डेमो चुनाव नहीं** — जो आप बनाएँगे वही दिखेगा। असली साझा वोटिंग के लिए `node server.js`।

---

## 💾 डेटा हमेशा के लिए (ज़रूरी!)

होस्टिंग के **free plan** पर फ़ाइल वाला डेटा रीस्टार्ट/redeploy पर मिट सकता है। इसलिए **Upstash Redis** जोड़िए — हमेशा मुफ़्त, कार्ड की ज़रूरत नहीं:

1. [upstash.com](https://upstash.com) पर साइन अप करें → **Create Database** (Redis, free)।
2. Database के **REST API** टैब से दो चीज़ें कॉपी करें।
3. होस्टिंग के Environment Variables में डालें:
   ```
   UPSTASH_REDIS_REST_URL   = https://xxxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN = AX...
   ```
4. रीस्टार्ट करें — अब हर चुनाव, हर वोट **स्थायी रूप से** सेव रहेगा (पहली बार अपने आप डेटा वहाँ चला जाएगा)।

*(बिना Upstash भी चलेगा — डेटा `data/db.json` में रहेगा; अगर होस्टर persistent disk देता है तो वहाँ भी सुरक्षित।)*

---

## 🚀 GitHub पर डालना + Live करना (step by step)

### A. GitHub पर रिपॉज़िटरी बनाएँ

1. [github.com/new](https://github.com/new) पर जाएँ।
2. **Repository name** में लिखें: `janmat`
   *(दूसरे विकल्प: `janmat-online-voting`, `janmat-voting-app`, `mera-janmat`)*
3. Description: `जनमत — अनोखा username + PIN वाला ऑनलाइन सामुदायिक मतदान मंच`
4. **Public** चुनें → **Create repository**।

### B. कोड चढ़ाएँ (तीन तरीक़े — कोई एक)

**तरीक़ा 1 — GitHub website (सबसे आसान, फ़ोन पर भी):**
1. रिपॉज़िटरी में **Add file → Upload files**।
2. ZIP खोलकर सारी फ़ाइलें/फ़ोल्डर ड्रैग करें (या ZIP ही अपलोड कर दें, पर बेहतर होगा फ़ोल्डर खोलकर)।
3. नीचे **Commit changes** दबाएँ।

**तरीक़ा 2 — GitHub Desktop:** ZIP खोलें → GitHub Desktop में *Add local repository* → **Publish repository**।

**तरीक़ा 3 — command line:**
```bash
cd janmat
git init
git add .
git commit -m "Janmat v2 — online voting platform"
git branch -M main
git remote add origin https://github.com/<aapka-username>/janmat.git
git push -u origin main
```

### C. Live करें (Render — मुफ़्त, कार्ड नहीं चाहिए)

1. [render.com](https://render.com) पर GitHub से साइन इन करें।
2. **New + → Web Service** → अपनी `janmat` रिपॉज़िटरी चुनें।
3. सेटिंग्स:
   - **Runtime**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
4. **Environment Variables** में जोड़ें:
   - `DEV_PASSWORD` = `<Render Dashboard में सेट करें>` *(या अपना नया पासवर्ड)*
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` *(डेटा स्थायी रखने के लिए)*
5. **Create Web Service** → 2-3 मिनट में लिंक मिलेगा, जैसे
   `https://janmat.onrender.com` — यही दुनिया भर के लिए आपकी साइट है।

> **वैकल्पिक तरीक़ा:** Render में **New + → Blueprint** चुनें और रिपॉज़िटरी दें — `render.yaml` से सारी सेटिंग्स अपने आप भर जाएँगी।

**अन्य होस्ट (बाद में ज़रूरत पड़े तो):** Railway, Fly.io, Koyeb — सब पर `npm start` चलता है। Docker चाहिए तो `Dockerfile` मौजूद है।

> ⚠️ Render का free plan 15 मिनट बाद सो जाता है; अगली बार खोलने पर ~1 मिनट में जागता है। पहले-पहल लिंक खोलते समय थोड़ा इंतज़ार सामान्य है।

---

## 🔌 API (डेवलपर के लिए)

| Method | Endpoint | काम |
|---|---|---|
| `GET` | `/api/auth/username/:username` | username उपलब्ध है या पहले से उपयोग में |
| `POST` | `/api/auth/register` | `{ name, username, password(PIN), deviceId }` → token |
| `POST` | `/api/auth/login` | `{ username, password(PIN), deviceId }` → token |
| `POST` | `/api/auth/migrate` / `/api/auth/set-username` | पुराने खाते को username+PIN में लाना |
| `POST` | `/api/auth/recover` | username + Recovery Code से नया PIN |
| `POST` | `/api/auth/username-hint` | उसी फ़ोन पर छिपा username संकेत |
| `POST` | `/api/auth/apply` / `/api/auth/application-status` | Team Janmat आवेदन और स्थिति |
| `GET` | `/api/auth/me` | अपना प्रोफ़ाइल + कोटा |
| `GET` | `/api/elections?q=` | सार्वजनिक सूची (कोई पहचान नहीं) |
| `POST` | `/api/elections` | चुनाव बनाएँ *(login ज़रूरी, रोज़ 2)* |
| `GET` | `/api/elections/:code` | चुनाव; मतदान के दौरान उम्मीदवार-गिनती छिपी, बंद होने पर अंतिम परिणाम |
| `POST` | `/api/elections/:code/vote` | वोट *(login या Guest; device लॉक)* |
| `POST` | `/api/elections/:code/close` / `reopen` | आयोजक या डेवलपर |
| `GET` | `/api/me/overview` | मेरे चुनाव + मेरे वोट |
| `POST` | `/api/dev/login` | `{ password }` → devToken |
| `GET` | `/api/dev/overview` | **सब कुछ** (users, elections, किसने किसको वोट) |
| `GET` | `/api/dev/elections/:code` | एक चुनाव का पूरा विवरण |
| `GET` | `/api/stream?election=CODE` | **SSE लाइव स्ट्रीम** — चुनाव अपडेट (सार्वजनिक) |
| `GET` | `/api/dev/stream?token=` | **SSE डेवलपर स्ट्रीम** — `vote`, `new-election`, `election-status`, `user-deleted` |
| `POST` | `/api/account/delete` | `{ confirm: true }` → खाता हटाएँ (गिनती बची रहती है) |
| `GET` | `/api/health` | सर्वर/स्टोरेज स्थिति |

Developer endpoints के लिए header: `x-dev-token: <devToken>`

---

## 🔒 सुरक्षा व सीमाएँ

- डेवलपर पासवर्ड कभी फ्रंटएंड में नहीं भेजा जाता; सर्वर पर timing-safe तरीक़े से जाँचा जाता है।
- डेवलपर लॉगिन: 10 मिनट में 8 कोशिशें; सत्र 12 घंटे।
- Public API से creator/voter की पहचान हमेशा छिपी रहती है।
- Username की आरक्षित सूची (`admin`, `developer` आदि) ब्लॉक है; PIN, Recovery Code और session token server पर hash रूप में रहते हैं।
- **ईमानदारी से:** बिना mobile/email/सरकारी पहचान के username+PIN खाते की रक्षा करता है, लेकिन किसी मनुष्य की 100% पहचान नहीं बन सकता। Device/browser बदलने पर सीमा रहती है; यह सामुदायिक/मत-सर्वे मंच है, आधिकारिक चुनाव प्रणाली नहीं।

---

## ⚠️ डिस्क्लेमर (साइट पर भी पूरा है)

यह मंच **निजी, स्वतंत्र और गैर-सरकारी** है। इसका भारत सरकार, राज्य सरकार, पंचायत/नगरपालिका, भारत निर्वाचन आयोग या किसी भी सरकारी निकाय से **कोई संबंध नहीं** है। यहाँ के परिणाम किसी आधिकारिक चुनाव के लिए मान्य नहीं हैं। मंच "जैसा है" उपलब्ध है और इसके उपयोग से होने वाली किसी भी हानि के लिए संचालक उत्तरदायी नहीं है।

---

## 🧪 टेस्ट किए गए फ़्लो

**v8 सत्यापन:** अलग local copies में मुख्य API परिदृश्य, पुराने data migration के 21 चेक, offline/preview के 17 चेक और असली page UI के 23 चेक पास हुए; username+PIN वाली CI smoke जाँच भी पूरी पास हुई। इनमें duplicate username रोक, PIN recovery, Guest→signup link, आवेदन approval और Developer Panel शामिल हैं।


**v2.1 में 64 चेक, सब पास** (Chromium में असली ब्राउज़र टेस्ट):

खाली डेटाबेस पर साइट खुलना (कोई डेमो चुनाव नहीं) → डार्क मोड टॉगल + रीलोड के बाद याद रहना → नाम से लॉगिन → सेटिंग्स के सभी 10 बटन → तीनों थीम विकल्प → नियम व शर्तें पेज → गोपनीयता पेज → चुनाव बनाना → डेवलपर पैनल में **लाइव फ़ीड** (वोट डालते ही बिना रीलोड दिखना + स्टैट अपडेट) → अनजान यूज़र को वोटर/क्रिएटर का नाम न दिखना (अलग ब्राउज़र से जाँचा) → API में पहचान न होना → खाता हटाना (नाम जाए, गिनती बचे) → मोबाइल 390px पर हॉरिज़ॉन्टल स्क्रॉल न होना → कोई JS एरर नहीं।

पुराने v2 के 10 फ़्लो भी पास: 3रा चुनाव रुकना, दोबारा वोट रुकना, वही डिवाइस दूसरे नाम से रुकना, आयोजक द्वारा बंद + विजेता, डेवलपर गलत पासवर्ड, डिस्क्लेमर।

---

## 📄 लाइसेंस

**सर्वाधिकार सुरक्षित (All Rights Reserved)** — यह परियोजना मालिक की निजी संपत्ति है। बिना लिखित अनुमति code की copy करके अपने नाम से चलाना/बाँटना मना है। पूरा विवरण `LICENSE` फ़ाइल में। (पुराने सार्वजनिक संस्करण उस समय के MIT लाइसेंस में थे; यह नियम इस संस्करण से लागू है।)
