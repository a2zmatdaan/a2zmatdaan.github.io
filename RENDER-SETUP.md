# 🚀 Render — लिंक कहाँ मिलेगा (मोबाइल से, 3 तरीक़े)

आपके screenshot में **Blueprint "Janmat" बन गया है और Synced है** ✅
पर सर्विस deploy नहीं हुई — इसलिए लिंक नहीं दिख रहा।
नीचे तीनों तरीक़े क्रम से आज़माएँ — इनमें से एक पक्का काम करेगा।

---

## 🅰️ तरीक़ा 1 — Blueprint के अंदर जाएँ (सबसे पहले यही करें)

अपनी ब्लूप्रिंट वाली स्क्रीन पर:

1. **"Janmat"** नाम पर टैप करें (नीला/underline वाला लिंक)
2. अंदर जाने पर आपको दिखेगा:
   - **Services** सेक्शन → उसमें **`janmat`** नाम की एक वेब सर्विस
   - या ऊपर एक बटन: **"Deploy Blueprint"** / **"Apply changes"** / **"Deploy latest"**
3. अगर बटन दिखे → **उसे दबाएँ** → 2–3 मिनट रुकें
4. अगर सर्विस दिखे → **`janmat`** पर टैप करें → ऊपर आपका पता आ जाएगा:

```
https://janmat-xxxx.onrender.com
```

> 💡 सर्विस के अंदर जाने पर नीचे **Logs** दिखेंगे — वहाँ "Your service is live 🎉"
> या "Build successful" लिखा हो तो सब ठीक है।

---

## 🅱️ तरीक़ा 2 — सीधे सर्विस लिस्ट में देखें

1. `dashboard.render.com` खोलें
2. ऊपर बाएँ **☰ (मेन्यू)** या workspace के नाम पर टैप करें
3. **Services** चुनें (या home page पर सर्विस कार्ड देखें)
4. वहाँ **`janmat`** कार्ड दिखना चाहिए — उस पर टैप करें → URL ऊपर मिलेगा

अगर वहाँ `janmat` नाम की कोई सर्विस ही नहीं है → तरीक़ा 3 करें।

---

## 🅲 तरीक़ा 3 — मैन्युअल Web Service (100% पक्का, 2 मिनट)

यह सबसे भरोसेमंद तरीक़ा है — Blueprint की उलझन ही नहीं।

1. Render पर **`+ New`** (या **New +**) दबाएँ
2. **Web Service** चुनें
3. **GitHub** चुनें → repo **`a2zmatdaan/a2zmatdaan.github.io`** → **Connect**
4. ये सेटिंग भरें (बाक़ी जैसा है वैसा छोड़ दें):

| सेटिंग | वैल्यू |
|---|---|
| **Name** | `janmat` |
| **Language / Runtime** | `Node` |
| **Branch** | `main` |
| **Region** | `Singapore` (भारत के सबसे नज़दीक) |
| **Root Directory** | *(खाली छोड़ें)* |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Instance Type** | **Free** |

5. नीचे **Environment Variables** (Advanced में) जोड़ें:

| Key | Value |
|---|---|
| `DEV_PASSWORD` | `<Render Dashboard में सेट करें>` |
| `DAILY_ELECTION_LIMIT` | `2` |
| `SEED_DEMO` | `0` |
| `NODE_VERSION` | `20` |

6. **Create Web Service** दबाएँ
7. 2–3 मिनट बाद ऊपर हरा बैनर: **"Your service is live 🎉"** और आपका पता:

```
https://janmat-xxxx.onrender.com
```

> ⚠️ मुफ़्त प्लान में एक ही समय में सीमित सर्विस चल सकती हैं। अगर Render कहे
> "free instance limit", तो पहले पुरानी ब्लूप्रिंट/सर्विस हटाएँ (Blueprint "Janmat"
> → ⋯ मेन्यू → Delete), फिर यह तरीक़ा करें।

---

## ✅ लिंक मिलने के बाद — 2 काम

### 1) जाँचें कि सर्वर चल रहा है
ब्राउज़र में खोलें:
```
https://janmat-xxxx.onrender.com/api/health
```
दिखना चाहिए: `{"ok":true,...}`
और मुख्य पता `https://janmat-xxxx.onrender.com` — साइट बिना पीली पट्टी के खुलेगी।

### 2) GitHub को बता दें (ताकि a2zmatdaan.github.io भी वही डेटा दिखाए)
repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**

| Name | Value |
|---|---|
| `API_BASE` | `https://janmat-xxxx.onrender.com` |
| `SITE_URL` | वही URL (Render को जगाए रखने के लिए — ज़रूरी नहीं) |

फिर **Actions → 0 · Auto Setup → Run workflow** दबाएँ (10 सेकंड)।
अब `a2zmatdaan.github.io` से पीली पट्टी गायब हो जाएगी।

---

## 😟 अगर कुछ और दिक्कत दिखे

| स्क्रीन पर क्या दिख रहा है | मतलब / हल |
|---|---|
| **"Build failed"** | सर्विस → **Logs** खोलें, आख़िरी 10 लाइन का screenshot भेजें |
| **"Deploy failed"** | वही — Logs भेजें |
| **"Free instance limit reached"** | पुरानी सर्विस/ब्लूप्रिंट delete करें, फिर तरीक़ा 3 |
| **"No services"** (ब्लूप्रिंट के अंदर) | तरीक़ा 3 (मैन्युअल) अपनाएँ |
| सर्विस **"Suspended"** | ⋯ मेन्यू → **Resume service** |
| लिंक खुलता है पर 50 सेकंड लगते हैं | मुफ़्त प्लान सोया हुआ है — पहली visit पर सामान्य है |
| लिंक खुला पर साइट नहीं | `startCommand` `npm start` है या नहीं देखें (तरीक़ा 3 की तालिका) |

---

## 📌 जो भी हो, मुझे यह भेज दें

- ब्लूप्रिंट के अंदर की स्क्रीन (Services सेक्शन), या
- सर्विस के **Logs** का screenshot

मैं तुरंत बता दूँगा कि अगला कदम क्या है।
