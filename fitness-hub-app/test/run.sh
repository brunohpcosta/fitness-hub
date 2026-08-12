#!/bin/bash
# Front-end render tests.
#
#   bash fitness-hub-app/test/run.sh
#
# Extracts the app's script, runs every render function against real data from
# the LOCAL D1 copy in a headless DOM, then asserts on what each one produced.
#
# Why this exists: syntax checks and endpoint tests both passed while the app
# was visibly broken on the phone — a CSS class that did not exist, a chart
# whose labels piled up on the left, a calendar that stopped at today. None of
# that is visible to `node --check`, and none of it is visible to curl.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$HERE/../public/index.html"
API="$HERE/../../fitness-hub-api"

python3 -c "
import re,sys
h=open('$APP').read()
sys.stdout.write(re.search(r'<script>\n(.*?)\n</script>', h, re.S).group(1))
" > /tmp/fh-app.js

echo "Building fixtures from the local database…"
python3 "$HERE/fixtures.py" > /tmp/fh-fixtures.json
echo

node "$HERE/render-harness.js"
node "$HERE/render-assert.js"
