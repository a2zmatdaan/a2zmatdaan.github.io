#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# जनमत — auto setup ka asli kaam (workflow isi ko chalata hai)
#   1) build (index.html self-contained)
#   2) asli server + 15 smoke checks
#   3) sab pass ho to khud commit + push
#   4) Render ka one-click link summary me
# ---------------------------------------------------------------------------
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-user/repo}"
BOLD() { printf '\n\033[1m%s\033[0m\n' "$*"; }

BOLD "1/3 · Build"
if [ -f build.js ]; then
  node build.js
  ls -lh public/index.html
else
  echo "build.js nahi mila — skip"
fi

BOLD "2/3 · Smoke test (asli server chala kar)"
if [ -f .github/scripts/smoke.sh ]; then
  PORT=3000 DEV_PASSWORD="${DEV_PASSWORD:-KHOHDEEG}" bash .github/scripts/smoke.sh
else
  echo "❌ .github/scripts/smoke.sh nahi mila — ZIP adhoora lagta hai"
  exit 1
fi

BOLD "3/3 · Commit"
rm -f data/db.json
git config user.name  "janmat-bot"
git config user.email "janmat-bot@users.noreply.github.com"
git add -A
if git diff --cached --quiet; then
  echo "✅ Kuch badalne ki zarurat nahi thi."
else
  git commit -m "chore(auto): setup + build by GitHub Action"
  if ! git push; then
    git push origin "HEAD:${GITHUB_REF_NAME:-main}"
  fi
  echo "✅ Changes commit ho gaye."
fi

# ---------------- summary (Actions ke upar dikhta hai) ---------------------
{
  echo "## ✅ सब तैयार"
  echo ""
  echo "अब बस **एक क्लिक** — साइट दुनिया के लिए live करने के लिए:"
  echo ""
  echo "### 👉 [Render पर Deploy करें](https://render.com/deploy?repo=https://github.com/${REPO})"
  echo ""
  echo '```'
  echo "https://render.com/deploy?repo=https://github.com/${REPO}"
  echo '```'
  echo ""
  echo "| चीज़ | क्या करना है |"
  echo "|---|---|"
  echo "| Render | पहली बार **GitHub से login** (कार्ड नहीं चाहिए) |"
  echo "| Blueprint | **Apply** दबाएँ — बाकी सब \`render.yaml\` से अपने आप |"
  echo "| लाइव URL | 2–3 मिनट में \`https://<service-name>.onrender.com\` |"
  echo ""
  echo "डेवलपर पैनल: \`/#/developer\` · पासवर्ड: \`KHOHDEEG\`"
  echo ""
  echo "> पहली बार खुलने में ~50 सेकंड लग सकते हैं (Render free plan सोता है)।"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
