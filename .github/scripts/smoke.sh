#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# जनमत — CI smoke test (bina browser ke, sirf curl + node)
# GitHub Action isi ko chalata hai. Fail hone par deploy nahi hota.
# ---------------------------------------------------------------------------
set -euo pipefail

PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"
PASS="${DEV_PASSWORD:-KHOHDEEG}"
DEVICE="ci-device-$(date +%s)"
FAILED=0

say() { printf '%s\n' "$*"; }
ok()  { say "  ✅ $*"; }
bad() { say "  ❌ $*"; FAILED=$((FAILED + 1)); }

# JSON se koi bhi nested value nikaalo:  json_get token
json_get() {
  node -e '
    const fs = require("fs");
    let raw = "";
    try { raw = fs.readFileSync(0, "utf8"); } catch (e) {}
    let v; try { v = JSON.parse(raw); } catch (e) { process.stdout.write(""); process.exit(0); }
    for (const k of process.argv[1].split(".")) v = (v === null || v === undefined) ? undefined : v[k];
    process.stdout.write(v === undefined || v === null ? "" : String(v));
  ' "$1"
}

say ""
say "🧪 जनमत smoke test — $BASE"

# --- server start -----------------------------------------------------------
node server.js > /tmp/janmat-ci.log 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT

READY=0
for _ in $(seq 1 40); do
  if curl -fsS "$BASE/api/health" > /tmp/janmat-health.json 2>/dev/null; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  bad "सर्वर स्टार्ट नहीं हुआ"
  cat /tmp/janmat-ci.log || true
  exit 1
fi
grep -q '"ok":true' /tmp/janmat-health.json && ok "हेल्थ ठीक" || bad "हेल्थ JSON ग़लत"

# --- home page --------------------------------------------------------------
if curl -fsS "$BASE/" -o /tmp/janmat-home.html && grep -q "जनमत" /tmp/janmat-home.html; then
  ok "होम पेज खुला ($(wc -c < /tmp/janmat-home.html) बाइट, self-contained)"
else
  bad "होम पेज नहीं खुला"
fi

# --- empty database (koi demo data nahi) ------------------------------------
STATS=$(curl -fsS "$BASE/api/stats" || echo '{}')
say "  ℹ️  stats: $STATS"
if [ "$(printf '%s' "$STATS" | json_get elections)" = "0" ] && [ "$(printf '%s' "$STATS" | json_get users)" = "0" ]; then
  ok "डेटाबेस खाली — कोई डेमो/फ़ेक डेटा नहीं"
else
  say "  ℹ️  पुराना डेटा मिला (CI में आमतौर पर खाली होता है)"
fi

# --- login ------------------------------------------------------------------
LOGIN=$(curl -fsS -X POST "$BASE/api/auth/register" -H 'content-type: application/json' \
  -d "{\"name\":\"CI जाँच\",\"username\":\"ci_jaanch\",\"password\":\"731946\",\"deviceId\":\"$DEVICE\"}")
TOKEN=$(printf '%s' "$LOGIN" | json_get token)
[ -n "$TOKEN" ] && [ "$(printf '%s' "$LOGIN" | json_get user.username)" = "ci_jaanch" ] && ok "unique username + PIN से नया खाता" || { bad "लॉगिन फेल"; exit 1; }
DUPUSER=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" -H 'content-type: application/json' -d "{\"name\":\"दूसरा CI\",\"username\":\"ci_jaanch\",\"password\":\"592847\",\"deviceId\":\"dusri-device-999\"}")
[ "$DUPUSER" = "409" ] && ok "वही username दूसरे को नहीं मिला (409)" || bad "duplicate username रुका नहीं (मिला $DUPUSER)"
WRONGPW=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"username\":\"ci_jaanch\",\"password\":\"999111\",\"deviceId\":\"dusri-device-999\"}")
[ "$WRONGPW" = "401" ] && ok "सिर्फ़ username जानकर घुसना रुका (गलत PIN 401)" || bad "गलत PIN रुका नहीं (मिला $WRONGPW)"

AUTH=(-H "x-user-token: $TOKEN" -H "x-device-id: $DEVICE")

# --- create election --------------------------------------------------------
CREATED=$(curl -fsS -X POST "$BASE/api/elections" -H 'content-type: application/json' "${AUTH[@]}" \
  -d '{"type":"सरपंच","title":"CI स्मोक चुनाव","gram":"टेस्ट गाँव","district":"जयपुर","state":"राजस्थान","candidates":[{"name":"अ उम्मीदवार","party":"","symbol":"diya"},{"name":"ब उम्मीदवार","party":"","symbol":"sunflower"}]}')
CODE=$(printf '%s' "$CREATED" | json_get election.code)
CAND=$(printf '%s' "$CREATED" | json_get election.candidates.0.id)
[ -n "$CODE" ] && ok "चुनाव बना (कोड $CODE)" || { bad "चुनाव नहीं बना"; exit 1; }

# --- vote -------------------------------------------------------------------
VOTED=$(curl -fsS -X POST "$BASE/api/elections/$CODE/vote" -H 'content-type: application/json' "${AUTH[@]}" \
  -d "{\"candidateId\":\"$CAND\"}")
[ "$(printf '%s' "$VOTED" | json_get ok)" = "true" ] && ok "वोट दर्ज हुआ" || bad "वोट नहीं पड़ा"

CODE2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/elections/$CODE/vote" \
  -H 'content-type: application/json' "${AUTH[@]}" -d "{\"candidateId\":\"$CAND\"}")
[ "$CODE2" = "409" ] && ok "दोबारा वोट रुका (409)" || bad "दोबारा वोट रुका नहीं (मिला $CODE2)"

# --- bina login vote (share link se aaya matadar) ---------------------------
GDEV="testdevice$RANDOM$RANDOM"
GV=$(curl -s -o /tmp/gv.json -w '%{http_code}' -X POST "$BASE/api/elections/$CODE/vote" \
  -H 'content-type: application/json' -H "x-device-id: $GDEV" -d "{\"candidateId\":\"$CAND\"}")
[ "$GV" = "200" ] && ok "बिना लॉगिन वोट चला (200)" || bad "बिना लॉगिन वोट नहीं चला (मिला $GV)"
GV2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/elections/$CODE/vote" \
  -H 'content-type: application/json' -H "x-device-id: $GDEV" -d "{\"candidateId\":\"$CAND\"}")
[ "$GV2" = "409" ] && ok "उसी डिवाइस का दूसरा वोट रुका (409)" || bad "डिवाइस दोबारा वोट कर गया (मिला $GV2)"

# --- public page par pehchan chhupi rahe ------------------------------------
PUB=$(curl -fsS "$BASE/api/elections/$CODE")
if printf '%s' "$PUB" | grep -q "CI जाँच"; then bad "सार्वजनिक API में वोटर का नाम लीक"; else ok "सार्वजनिक API में पहचान नहीं"; fi
[ "$(printf '%s' "$PUB" | json_get totalVotes)" = "2" ] && ok "गिनती दिख रही (2)" || bad "गिनती ग़लत"

# --- developer panel --------------------------------------------------------
DEV=$(curl -fsS -X POST "$BASE/api/dev/login" -H 'content-type: application/json' -d "{\"password\":\"$PASS\"}")
DTOK=$(printf '%s' "$DEV" | json_get devToken)
[ -n "$DTOK" ] && ok "डेवलपर लॉगिन" || bad "डेवलपर लॉगिन फेल"

BADCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/dev/login" -H 'content-type: application/json' -d '{"password":"galat-password"}')
[ "$BADCODE" = "401" ] || [ "$BADCODE" = "429" ] && ok "गलत डेवलपर पासवर्ड रुका ($BADCODE)" || bad "गलत पासवर्ड रुका नहीं ($BADCODE)"

if [ -n "$DTOK" ]; then
  OV=$(curl -fsS "$BASE/api/dev/overview" -H "x-dev-token: $DTOK")
  if printf '%s' "$OV" | grep -q "CI जाँच"; then ok "डेवलपर को वोटर का नाम दिखता है"; else bad "डेवलपर डेटा में नाम नहीं"; fi
fi

# --- account delete: naam jaaye, ginti bache ---------------------------------
DEL=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/account/delete" \
  -H 'content-type: application/json' "${AUTH[@]}" -d '{"confirm":true}')
[ "$DEL" = "200" ] && ok "खाता हटा" || bad "खाता नहीं हटा ($DEL)"
PUB2=$(curl -fsS "$BASE/api/elections/$CODE")
[ "$(printf '%s' "$PUB2" | json_get totalVotes)" = "2" ] && ok "खाता हटने के बाद भी वोट की गिनती बची" || bad "गिनती बदल गई"

# --- result -----------------------------------------------------------------
say ""
if [ "$FAILED" -eq 0 ]; then
  say "✅ सारे smoke चेक पास"
  exit 0
fi
say "❌ $FAILED चेक फेल — लॉग देखें: /tmp/janmat-ci.log"
tail -30 /tmp/janmat-ci.log || true
exit 1
