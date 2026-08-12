#!/bin/bash
# ============================================================================
# Fitness Hub — Stage 4 audit addendum
#
#   bash ~/Documents/fitness-hub/scripts/audit-stage4.sh
#
# Covers only what Stage 4 added: the read and write API, CORS, the front end,
# and the data corrections. Run it AFTER ~/Desktop/audit.sh, which still owns
# authentication, ingest robustness, timezone handling, schema parity and
# source control. This does not repeat those.
#
# Writes one daily_log row against a 2019 date to test the write path, then
# deletes it. Everything else is read-only.
#
# Lives in the repo deliberately. audit.sh sits on the Desktop, outside version
# control, which means the one thing that checks the project is the one thing
# not backed up by it.
# ============================================================================

set -uo pipefail

PROJECT="$HOME/Documents/fitness-hub/fitness-hub-api"
APP="$HOME/Documents/fitness-hub/fitness-hub-app"
API="https://fitness-hub-api.bruno-hpc93.workers.dev"
PAGES="https://bruno-fitness-hub.pages.dev"
DB="fitness-hub-db"
TESTDATE="2019-01-02"

cd "$PROJECT" || { echo "Cannot find $PROJECT"; exit 1; }
SECRET=$(grep '^INGEST_SECRET=' .dev.vars | cut -d= -f2-)

PASS=0; FAIL=0; WARN=0
FAILED_TESTS=()
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN+1)); }

expect_status() {
  local desc="$1" want="$2"; shift 2
  local got; got=$(curl -s -o /dev/null -w "%{http_code}" "$@")
  [ "$got" = "$want" ] && ok "$desc (got $got)" || bad "$desc — wanted $want, got $got"
}

# Fetch JSON and pull a value out with a python expression over `d`
jq_get() {
  local url="$1" expr="$2"
  curl -s "$url" -H "Authorization: Bearer $SECRET" \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin); print($expr)
except Exception as e:
    print('ERR')
" 2>/dev/null
}

expect_json() {
  local desc="$1" url="$2" expr="$3" want="$4"
  local got; got=$(jq_get "$url" "$expr")
  if [ "$got" = "ERR" ]; then bad "$desc — request or parse failed"
  elif [ "$got" = "$want" ]; then ok "$desc"
  else bad "$desc — wanted $want, got $got"; fi
}

sql() {
  local where="${2:---remote}"
  npx wrangler d1 execute "$DB" $where --json --command "$1" 2>/dev/null \
    | python3 -c "
import json,sys
try:
    r=json.load(sys.stdin)[0]['results']; print(list(r[0].values())[0] if r else 0)
except Exception: print('ERR')
"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          FITNESS HUB — STAGE 4 AUDIT ADDENDUM                ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ───────────────────────── 1. READ API ─────────────────────────
echo ""
echo "1. READ API — does every endpoint the app depends on answer?"
echo "───────────────────────────────────────────────────────────────"

for p in today plan days runs targets goals photos; do
  expect_status "GET /api/$p responds" 200 "$API/api/$p" -H "Authorization: Bearer $SECRET"
done

expect_status "Read endpoints reject a missing key" 401 "$API/api/today"
expect_status "Read endpoints reject a wrong key" 401 "$API/api/today" -H "Authorization: Bearer nonsense"

# ───────────────────────── 2. DATA CORRECTNESS ─────────────────────────
echo ""
echo "2. DATA CORRECTNESS — are the numbers the ones we verified?"
echo "───────────────────────────────────────────────────────────────"

expect_json "Race spike computed live, not hardcoded" \
  "$API/api/runs?from=2026-07-01" "d['race_spike']['increase_pct']" "83.3"
expect_json "Spike uses the 1 Aug run as longest in window" \
  "$API/api/runs?from=2026-07-01" "d['race_spike']['longest_date']" "2026-08-01"
expect_json "Rehearsal day resolves to long_run" \
  "$API/api/today?date=2026-08-15" "d['day_type']" "long_run"
expect_json "Carb-load day falls back to the general target" \
  "$API/api/targets?date=2026-08-20" "d['targets']['fell_back']" "1"
expect_json "Carb-load target is 3300 kcal" \
  "$API/api/targets?date=2026-08-20" "d['targets']['energy_kcal']" "3300"
expect_json "Targets expire after the race, by design" \
  "$API/api/targets?date=2026-08-25" "d['expired']" "True"
expect_json "Plan covers all ten days" \
  "$API/api/plan?from=2026-08-13&to=2026-08-22" "d['count']" "10"
expect_json "Ten goals, all active" \
  "$API/api/goals" "d['count']" "10"
expect_json "Weekly km goal has no target, deliberately" \
  "$API/api/goals" "[g['target_value'] for g in d['goals'] if g['metric_key']=='run_km_7d'][0]" "None"

echo ""
echo "  Data corrections applied in Stage 4:"
V=$(sql "SELECT COUNT(*) FROM workouts WHERE source='strava' AND notes LIKE 'superseded%'")
[ "$V" = "16" ] && ok "All 16 Strava duplicates flagged superseded" || bad "Strava flagged: $V, wanted 16"

V=$(sql "SELECT COUNT(*) FROM workouts WHERE kind='run' AND source='strava' AND (notes IS NULL OR notes NOT LIKE 'superseded%')")
[ "$V" = "0" ] && ok "No unflagged Strava runs remain" || bad "$V Strava runs still counted"

V=$(sql "SELECT COUNT(*) FROM nutrition_intake WHERE source='Cronometer' AND local_date>='2026-08-01'")
[ "$V" != "ERR" ] && [ "$V" -gt 0 ] && ok "Dietary metrics reaching nutrition_intake ($V days in August)" \
  || warn "No August Cronometer rows — check the HAE automation"

# Rows written on 12 Aug predate the routing change and are harmless leftovers —
# nothing reads them. What matters is that no NEW ones appear, so the cutoff is
# the day after the parser was deployed.
V=$(sql "SELECT COUNT(*) FROM health_metrics WHERE metric_name IN ('dietary_energy','protein','carbohydrates','total_fat','dietary_sugar','sodium') AND local_date>'2026-08-12'")
[ "$V" = "0" ] && ok "No new dietary rows landing in health_metrics" \
  || bad "$V dietary rows in health_metrics after the routing change — parser not deployed"

V=$(sql "SELECT COUNT(*) FROM health_metrics WHERE metric_name IN ('dietary_energy','protein','carbohydrates','total_fat','dietary_sugar','sodium')")
[ "$V" != "ERR" ] && [ "$V" -gt 0 ] \
  && warn "$V pre-routing dietary rows remain in health_metrics — orphaned, nothing reads them" \
  || ok "No orphaned dietary rows in health_metrics"

# ───────────────────────── 3. WRITE API ─────────────────────────
echo ""
echo "3. WRITE API — does it reject bad input and stay idempotent?"
echo "───────────────────────────────────────────────────────────────"

post_log() {
  curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/log" \
    -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" -d "$1"
}

expect_status "Write rejects an unauthenticated request" 401 -X POST "$API/api/log" \
  -H "Content-Type: application/json" -d '{"local_date":"2019-01-02"}'

G=$(post_log '{"local_date":"not-a-date"}');            [ "$G" = "400" ] && ok "Malformed date rejected" || bad "Malformed date got $G"
G=$(post_log '{"local_date":"2030-01-01","weight_kg":80}'); [ "$G" = "400" ] && ok "Future date rejected" || bad "Future date got $G"
G=$(post_log "{\"local_date\":\"$TESTDATE\",\"ratings\":{\"hours_slept\":20}}"); [ "$G" = "400" ] && ok "Sleep over the 16 h limit rejected" || bad "hours_slept 20 got $G"
G=$(post_log "{\"local_date\":\"$TESTDATE\",\"ratings\":{\"sleep_quality\":9}}"); [ "$G" = "400" ] && ok "Rating outside 1-5 rejected" || bad "rating 9 got $G"
G=$(post_log "{\"local_date\":\"$TESTDATE\",\"weight_kg\":400}");                 [ "$G" = "400" ] && ok "Impossible weight rejected" || bad "weight 400 got $G"

# Real write, twice, to prove it upserts rather than duplicates.
G=$(post_log "{\"local_date\":\"$TESTDATE\",\"weight_kg\":79.1,\"ratings\":{\"hours_slept\":7,\"sleep_quality\":4}}")
[ "$G" = "200" ] && ok "Valid check-in accepted" || bad "Valid write got $G"
post_log "{\"local_date\":\"$TESTDATE\",\"ratings\":{\"soreness\":3}}" > /dev/null

V=$(sql "SELECT COUNT(*) FROM daily_log WHERE local_date='$TESTDATE'")
[ "$V" = "1" ] && ok "Two saves produce one row, not two" || bad "daily_log rows for test date: $V"

V=$(sql "SELECT sleep_quality FROM daily_log WHERE local_date='$TESTDATE'")
[ "$V" = "4" ] && ok "Partial second save preserved the first" || bad "sleep_quality after partial save: $V"

V=$(sql "SELECT COUNT(*) FROM body_measurements WHERE local_date='$TESTDATE' AND source='app'")
[ "$V" = "1" ] && ok "Manual weight written with source='app'" || bad "app weight rows: $V"

# Clean up
npx wrangler d1 execute "$DB" --remote --command \
  "DELETE FROM daily_log WHERE local_date='$TESTDATE'; DELETE FROM body_measurements WHERE local_date='$TESTDATE' AND source='app';" >/dev/null 2>&1
V=$(sql "SELECT COUNT(*) FROM daily_log WHERE local_date='$TESTDATE'")
[ "$V" = "0" ] && ok "Test rows cleaned up" || bad "Test rows left behind: $V"

# ───────────────────────── 4. CORS ─────────────────────────
echo ""
echo "4. CORS — can the browser talk to the API, and only from our origin?"
echo "───────────────────────────────────────────────────────────────"

# Herestrings here too — same SIGPIPE trap, and these responses only stay small
# by accident. A test that works because the input happened to fit in a buffer
# is not a test that works.
H=$(curl -s -i -X OPTIONS "$API/api/today" -H "Origin: $PAGES" -H "Access-Control-Request-Method: GET")
grep -q "204" <<< "$(head -1 <<< "$H")" && ok "Preflight from the app origin returns 204" || bad "Preflight status: $(head -1 <<< "$H")"
grep -qi "access-control-allow-origin: $PAGES" <<< "$H" && ok "Allow-Origin echoes the app origin" || bad "Allow-Origin header missing"

H=$(curl -s -i -X OPTIONS "$API/api/today" -H "Origin: https://evil.example")
grep -q "403" <<< "$(head -1 <<< "$H")" && ok "Preflight from an unknown origin refused" || bad "Unknown origin got: $(head -1 <<< "$H")"
grep -qi "access-control-allow-origin" <<< "$H" && bad "Allow-Origin leaked to an unknown origin" || ok "No Allow-Origin for unknown origins"

H=$(curl -s -i "$API/data/summary" -H "Authorization: Bearer $SECRET")
grep -q "200" <<< "$(head -1 <<< "$H")" && ok "Phone path still works with no Origin header" || bad "No-Origin request failed"
grep -qi "access-control-allow-origin" <<< "$H" && warn "CORS headers sent to a non-browser client" || ok "No CORS headers when no Origin sent"

# ───────────────────────── 5. FRONT END ─────────────────────────
echo ""
echo "5. FRONT END — is what is deployed what we think it is?"
echo "───────────────────────────────────────────────────────────────"

expect_status "App is reachable" 200 "$PAGES/"
expect_status "Service worker is served" 200 "$PAGES/sw.js"
expect_status "Manifest is served" 200 "$PAGES/manifest.webmanifest"
expect_status "Icon is served" 200 "$PAGES/icon-192.png"

# --compressed matters: Pages serves this gzipped, and without it the body is
# unreadable bytes. That is worth stating because the first version of these
# checks was mostly "grep finds nothing", which passes just as happily against
# garbage as against a correct page. Readability is proven first, and only then
# is anything asserted about the contents.
B=$(curl -s --compressed "$PAGES/")

# Herestrings, not `echo "$B" | grep`. With pipefail set, `grep -q` stops
# reading as soon as it matches and closes the pipe; on a body larger than the
# 64 KB pipe buffer, echo is still writing, takes SIGPIPE, and the pipeline
# reports failure even though the match SUCCEEDED. That produced a false
# failure here for exactly one reason: the HTML is 105 KB. Small responses,
# like the CORS headers above, fit in the buffer and never showed it.
#
# The insidious part is that it only breaks POSITIVE matches. A grep that finds
# nothing reads to the end, so every "check something is absent" test passed
# regardless — including against output that was never readable at all.
if grep -q '<title>Fitness Hub</title>' <<< "$B"; then
  ok "App HTML is readable"

  MISSING=""
  for t in hub summary training running diet body goals; do
    grep -q "id=\"p-$t\"" <<< "$B" || MISSING="$MISSING $t"
  done
  [ -z "$MISSING" ] && ok "All seven tab sections present" || bad "Tab section(s) missing:$MISSING"

  grep -q 'is not connected yet' <<< "$B" && bad "A placeholder stub is still shipping" || ok "No placeholder stubs left in the build"
  grep -q 'fonts.googleapis.com' <<< "$B" && warn "Google Fonts still referenced — a slow CDN blocks first paint" || ok "No external font dependency"

  # Sanity: the page should be substantial. A near-empty 200 would pass every
  # "absent" check above and mean nothing.
  SIZE=${#B}
  [ "$SIZE" -gt 50000 ] && ok "App HTML is a plausible size (${SIZE} bytes)" \
    || bad "App HTML is only ${SIZE} bytes — suspiciously small"
else
  bad "Could not read the app HTML — nothing below it can be trusted"
fi

LOCAL_SW=$(grep -o "fitness-hub-shell-v[0-9.]*[a-z-]*" "$APP/public/sw.js" | head -1)
LIVE_SW=$(curl -s "$PAGES/sw.js" | grep -o "fitness-hub-shell-v[0-9.]*[a-z-]*" | head -1)
[ "$LOCAL_SW" = "$LIVE_SW" ] && ok "Deployed service worker matches local ($LIVE_SW)" \
  || bad "Deploy is stale — local $LOCAL_SW, live $LIVE_SW"

# ───────────────────────── 6. V2 UNTOUCHED ─────────────────────────
echo ""
echo "6. V2 — has anything here reached across to it?"
echo "───────────────────────────────────────────────────────────────"

cd "$HOME/Documents/fitness-hub" || exit 1
# Excluding node_modules deliberately — without it this walks tens of thousands
# of dependency files and appears to hang.
if grep -rq "script.google.com" \
     --include="*.js" --include="*.html" \
     --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.wrangler \
     . 2>/dev/null; then
  bad "A reference to the v2 Apps Script endpoint exists in this repo"
else
  ok "No reference to the v2 Apps Script anywhere in the repo"
fi

V=$(sql "SELECT COUNT(*) FROM nutrition_intake WHERE source='v2_sheet' AND local_date>='2026-08-01'")
[ "$V" = "0" ] && ok "Nothing new written under the v2_sheet source" || warn "$V recent v2_sheet rows"

# ───────────────────────── SUMMARY ─────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
printf "║  PASSED: %-3s   FAILED: %-3s   WARNINGS: %-3s                  ║\n" "$PASS" "$FAIL" "$WARN"
echo "╚══════════════════════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "FAILURES:"
  for f in "${FAILED_TESTS[@]}"; do echo "  • $f"; done
fi
echo ""
echo "This covers Stage 4 only. Run ~/Desktop/audit.sh as well — it owns"
echo "authentication, ingest robustness, timezone handling, schema parity"
echo "and source control, and it has not been run since Stage 3."
echo ""
