#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# जनमत — CI smoke test (bina browser ke, sirf curl + node)
# GitHub Action isi ko chalata hai. Fail hone par deploy nahi hota.
# ---------------------------------------------------------------------------
set -euo pipefail

PORT="${PORT:-3000}"
BASE="http://127.0.0.1:${PORT}"
PASS="${DEV_PASSWORD:-JanmatCiTestOnly!2026}"
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
USERID=$(printf '%s' "$LOGIN" | json_get user.id)
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
[ -z "$(printf '%s' "$PUB" | json_get totalVotes)" ] && ok "चलते चुनाव में सार्वजनिक कुल वोट छिपे हैं" || bad "चलते चुनाव में कुल वोट दिख गए"

# --- developer panel --------------------------------------------------------
DEV=$(curl -fsS -X POST "$BASE/api/dev/login" -H 'content-type: application/json' -d "{\"password\":\"$PASS\"}")
DTOK=$(printf '%s' "$DEV" | json_get devToken)
[ -n "$DTOK" ] && ok "डेवलपर लॉगिन" || bad "डेवलपर लॉगिन फेल"

BADCODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/dev/login" -H 'content-type: application/json' -d '{"password":"galat-password"}')
[ "$BADCODE" = "401" ] || [ "$BADCODE" = "429" ] && ok "गलत डेवलपर पासवर्ड रुका ($BADCODE)" || bad "गलत पासवर्ड रुका नहीं ($BADCODE)"

if [ -n "$DTOK" ]; then
  OV=$(curl -fsS "$BASE/api/dev/overview" -H "x-dev-token: $DTOK")
  if printf '%s' "$OV" | grep -q "CI जाँच"; then ok "डेवलपर को वोटर का नाम दिखता है"; else bad "डेवलपर डेटा में नाम नहीं"; fi
  CLOSECODE=$(curl -s -o /tmp/janmat-close.json -w '%{http_code}' -X POST "$BASE/api/elections/$CODE/close" -H 'content-type: application/json' -H "x-dev-token: $DTOK" -d '{}')
  [ "$CLOSECODE" = "200" ] && ok "डेवलपर ने परीक्षण चुनाव बंद किया" || bad "परीक्षण चुनाव बंद नहीं हुआ ($CLOSECODE)"
  PUBCLOSED=$(curl -fsS "$BASE/api/elections/$CODE")
  [ "$(printf '%s' "$PUBCLOSED" | json_get totalVotes)" = "2" ] && ok "समाप्ति के बाद कुल वोट (2) सार्वजनिक हुए" || bad "समाप्ति के बाद कुल वोट नहीं दिखे"

  # --- developer account moderation: temp ban -> unban -> permanent ban -> unban ---
  if [ -n "$USERID" ]; then
    MOD=$(curl -s -o /tmp/janmat-mod.json -w '%{http_code}' -X POST "$BASE/api/dev/users/$USERID/moderate" -H 'content-type: application/json' -H "x-dev-token: $DTOK" -d '{"action":"ban-temporary","days":7,"reason":"CI test"}')
    [ "$MOD" = "200" ] && ok "डेवलपर ने 7 दिन की अस्थायी रोक लगाई" || bad "अस्थायी रोक नहीं लगी ($MOD)"
    OLDME=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" "${AUTH[@]}")
    [ "$OLDME" = "401" ] && ok "रोक लगते ही पुराना session बंद" || bad "पुराना session बंद नहीं हुआ ($OLDME)"
    BANLOGIN=$(curl -s -o /tmp/janmat-ban.json -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"username\":\"ci_jaanch\",\"password\":\"731946\",\"deviceId\":\"$DEVICE\"}")
    [ "$BANLOGIN" = "403" ] && grep -q 'ACCOUNT_BANNED_TEMPORARY' /tmp/janmat-ban.json && ok "अस्थायी रोक में login 403 + कारण" || bad "अस्थायी रोक login नहीं रुका ($BANLOGIN)"

    UNBAN=$(curl -s -o /tmp/janmat-unban.json -w '%{http_code}' -X POST "$BASE/api/dev/users/$USERID/moderate" -H 'content-type: application/json' -H "x-dev-token: $DTOK" -d '{"action":"unban"}')
    [ "$UNBAN" = "200" ] && ok "डेवलपर ने रोक हटाई" || bad "रोक नहीं हटी ($UNBAN)"
    LOGIN2=$(curl -s -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"username\":\"ci_jaanch\",\"password\":\"731946\",\"deviceId\":\"$DEVICE\"}")
    TOKEN=$(printf '%s' "$LOGIN2" | json_get token)
    AUTH=(-H "x-user-token: $TOKEN" -H "x-device-id: $DEVICE")
    [ -n "$TOKEN" ] && ok "रोक हटने के बाद login फिर चला" || bad "रोक हटने के बाद login नहीं चला"

    PERM=$(curl -s -o /tmp/janmat-perm.json -w '%{http_code}' -X POST "$BASE/api/dev/users/$USERID/moderate" -H 'content-type: application/json' -H "x-dev-token: $DTOK" -d '{"action":"ban-permanent","reason":"CI permanent"}')
    [ "$PERM" = "200" ] && ok "डेवलपर ने स्थायी रोक लगाई" || bad "स्थायी रोक नहीं लगी ($PERM)"
    PERMLOGIN=$(curl -s -o /tmp/janmat-perm-login.json -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"username\":\"ci_jaanch\",\"password\":\"731946\",\"deviceId\":\"$DEVICE\"}")
    [ "$PERMLOGIN" = "403" ] && grep -q 'ACCOUNT_BANNED_PERMANENT' /tmp/janmat-perm-login.json && ok "स्थायी रोक में login 403" || bad "स्थायी रोक login नहीं रुका ($PERMLOGIN)"
    UNBAN2=$(curl -s -o /tmp/janmat-unban2.json -w '%{http_code}' -X POST "$BASE/api/dev/users/$USERID/moderate" -H 'content-type: application/json' -H "x-dev-token: $DTOK" -d '{"action":"unban"}')
    [ "$UNBAN2" = "200" ] && ok "स्थायी रोक भी डेवलपर ने हटाई" || bad "स्थायी रोक नहीं हटी ($UNBAN2)"
    LOGIN3=$(curl -s -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d "{\"username\":\"ci_jaanch\",\"password\":\"731946\",\"deviceId\":\"$DEVICE\"}")
    TOKEN=$(printf '%s' "$LOGIN3" | json_get token)
    AUTH=(-H "x-user-token: $TOKEN" -H "x-device-id: $DEVICE")
    [ -n "$TOKEN" ] && ok "स्थायी रोक हटने के बाद login चला" || bad "स्थायी रोक हटने के बाद login नहीं चला"
  fi

  # --- developer delete: alag test account login/session band ---
  DELREG=$(curl -s -X POST "$BASE/api/auth/register" -H 'content-type: application/json' -d '{"name":"CI हटाना","username":"ci_delete","password":"731946","deviceId":"ci-delete-device-001"}')
  DELID=$(printf '%s' "$DELREG" | json_get user.id)
  DELTOK=$(printf '%s' "$DELREG" | json_get token)
  if [ -n "$DELID" ] && [ -n "$DELTOK" ]; then
    DEVDEL=$(curl -s -o /tmp/janmat-dev-delete.json -w '%{http_code}' -X POST "$BASE/api/dev/users/$DELID/moderate" -H 'content-type: application/json' -H "x-dev-token: $DTOK" -d '{"action":"delete","confirm":true,"reason":"CI delete"}')
    [ "$DEVDEL" = "200" ] && ok "डेवलपर ने गलत/परीक्षण खाता हटाया" || bad "डेवलपर delete नहीं हुआ ($DEVDEL)"
    OVREC=$(curl -fsS "$BASE/api/dev/overview" -H "x-dev-token: $DTOK")
    [ "$(printf '%s' "$OVREC" | json_get stats.userRecords.deleted)" = "1" ] && [ "$(printf '%s' "$OVREC" | json_get stats.userRecords.developerDeleted)" = "1" ] && ok "हटाए खातों की अलग कुल गिनती" || bad "हटाए खातों की गिनती गलत"
    printf '%s' "$OVREC" | grep -q 'deletedSnapshot' && printf '%s' "$OVREC" | grep -q 'CI हटाना' && ok "हटाए खाते का नाम/username रिकॉर्ड snapshot" || bad "हटाए खाते का snapshot नहीं मिला"
    DELME=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" -H "x-user-token: $DELTOK" -H 'x-device-id: ci-delete-device-001')
    [ "$DELME" = "401" ] && ok "हटाए खाते का session बंद" || bad "हटाए खाते का session बंद नहीं ($DELME)"
    DELLOGIN=$(curl -s -o /tmp/janmat-del-login.json -w '%{http_code}' -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"username":"ci_delete","password":"731946","deviceId":"ci-delete-device-001"}')
    [ "$DELLOGIN" = "401" ] && grep -q 'ACCOUNT_DELETED' /tmp/janmat-del-login.json && ok "हटाए खाते से login बंद" || bad "हटाए खाते से login नहीं रुका ($DELLOGIN)"
  else
    bad "delete परीक्षण खाता नहीं बना"
  fi
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
