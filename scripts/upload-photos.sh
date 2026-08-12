#!/usr/bin/env bash
#
# Upload progress photos to the fitness-hub-photos R2 bucket.
#
#   ./upload-photos.sh ~/Documents/Fitness/photos            # dry run, uploads nothing
#   ./upload-photos.sh ~/Documents/Fitness/photos --go       # actually upload
#
# Deliberately dry-run by default. It lists exactly what it would do and stops,
# so you see the full picture before a single byte moves.
#
# Expected filenames: YYYY-MM-DD-view.jpg  e.g. 2026-08-02-front.jpg
# Anything that does not match that pattern is reported and skipped rather than
# uploaded under a key nothing can read back.
#
# Must be run from anywhere, but uses the pinned wrangler in fitness-hub-api so
# it cannot pick up a different version than the project was built against.

set -euo pipefail

BUCKET="fitness-hub-photos"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER="$REPO/fitness-hub-api/node_modules/.bin/wrangler"

SRC="${1:-}"
GO="${2:-}"

if [[ -z "$SRC" ]]; then
  echo "usage: $0 <folder-with-photos> [--go]"
  exit 1
fi
if [[ ! -d "$SRC" ]]; then
  echo "Not a folder: $SRC"
  exit 1
fi
if [[ ! -x "$WRANGLER" ]]; then
  echo "Pinned wrangler not found at $WRANGLER"
  echo "Run npm install in fitness-hub-api first."
  exit 1
fi

echo "Source : $SRC"
echo "Bucket : $BUCKET"
echo "Mode   : $([[ "$GO" == "--go" ]] && echo 'UPLOAD' || echo 'dry run — nothing will be written')"
echo

ok=0; bad=0
declare -a GOOD_FILES=() GOOD_KEYS=()

while IFS= read -r -d '' f; do
  base="$(basename "$f")"
  if [[ "$base" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})-([A-Za-z]+)\.(jpg|jpeg|png|JPG|JPEG|PNG)$ ]]; then
    key="${BASH_REMATCH[1]}-$(echo "${BASH_REMATCH[2]}" | tr '[:upper:]' '[:lower:]').${BASH_REMATCH[3]}"
    key="$(echo "$key" | tr '[:upper:]' '[:lower:]')"
    GOOD_FILES+=("$f"); GOOD_KEYS+=("$key")
    ok=$((ok+1))
  else
    echo "  SKIP (name does not match YYYY-MM-DD-view.ext): $base"
    bad=$((bad+1))
  fi
done < <(find "$SRC" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 | sort -z)

echo
echo "Matched : $ok"
echo "Skipped : $bad"
echo

if [[ $ok -eq 0 ]]; then
  echo "Nothing to upload."
  exit 0
fi

echo "First five keys that would be created:"
for i in 0 1 2 3 4; do
  [[ $i -lt $ok ]] && echo "  $BUCKET/${GOOD_KEYS[$i]}"
done
echo

if [[ "$GO" != "--go" ]]; then
  echo "Dry run. Re-run with --go to upload."
  echo
  echo "Before uploading all of them, upload one by hand and confirm the syntax"
  echo "works with your wrangler version:"
  echo
  echo "  $WRANGLER r2 object put \"$BUCKET/${GOOD_KEYS[0]}\" --file \"${GOOD_FILES[0]}\" --remote"
  echo
  exit 0
fi

echo "Uploading $ok files. Ctrl-C stops it; anything already uploaded stays."
echo
fail=0
for i in "${!GOOD_FILES[@]}"; do
  printf '[%3d/%3d] %s ... ' "$((i+1))" "$ok" "${GOOD_KEYS[$i]}"
  if "$WRANGLER" r2 object put "$BUCKET/${GOOD_KEYS[$i]}" \
       --file "${GOOD_FILES[$i]}" --remote >/dev/null 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    fail=$((fail+1))
  fi
done

echo
echo "Done. $((ok-fail)) uploaded, $fail failed."
[[ $fail -gt 0 ]] && echo "Re-run to retry — an object that already exists is simply overwritten."
exit 0
