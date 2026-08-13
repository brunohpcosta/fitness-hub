#!/usr/bin/env bash
#
# Upload progress photos to the fitness-hub-photos R2 bucket.
#
#   ./upload-photos.sh ~/Documents/Fitness/fitness-hub/01-photos          # dry run
#   ./upload-photos.sh ~/Documents/Fitness/fitness-hub/01-photos --go     # upload
#   ./upload-photos.sh ~/Documents/Fitness/fitness-hub/01-photos --go --resume
#
# Dry run by default. Expected filenames: YYYY-MM-DD-view.jpg
#
# Rewritten after a first run uploaded 37 of 123 and failed the rest with no
# explanation. Four things were wrong:
#
#   1. Errors went to /dev/null. A failure told you nothing about why, which is
#      useless precisely when you need it. Now captured and shown.
#   2. Ctrl-C did not stop it. The loop carried on through 90 more files. Now
#      trapped and exits cleanly.
#   3. No pacing. Each upload spawns a fresh wrangler process and re-auths, and
#      firing 123 of those as fast as possible looks like abuse to the API.
#      Now paced, with retry and backoff.
#   4. No resume. A re-run repeated everything. --resume skips what is already
#      in the bucket.

set -uo pipefail

BUCKET="fitness-hub-photos"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER="$REPO/fitness-hub-api/node_modules/.bin/wrangler"

SRC="${1:-}"
shift || true
GO=0; RESUME=0
for a in "$@"; do
  [[ "$a" == "--go" ]] && GO=1
  [[ "$a" == "--resume" ]] && RESUME=1
done

[[ -z "$SRC" ]]   && { echo "usage: $0 <folder> [--go] [--resume]"; exit 1; }
[[ ! -d "$SRC" ]] && { echo "Not a folder: $SRC"; exit 1; }
[[ ! -x "$WRANGLER" ]] && { echo "Pinned wrangler not found at $WRANGLER"; exit 1; }

INTERRUPTED=0
trap 'INTERRUPTED=1; echo; echo "Interrupted. Anything already uploaded stays — re-run with --resume."; exit 130' INT

echo "Source : $SRC"
echo "Bucket : $BUCKET"
echo "Mode   : $([[ $GO -eq 1 ]] && echo 'UPLOAD' || echo 'dry run — nothing will be written')"
[[ $RESUME -eq 1 ]] && echo "Resume : skipping objects already in the bucket"
echo

ok=0; bad=0
declare -a FILES=() KEYS=()
while IFS= read -r -d '' f; do
  base="$(basename "$f")"
  if [[ "$base" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})-([A-Za-z]+)\.(jpg|jpeg|png|JPG|JPEG|PNG)$ ]]; then
    key="$(echo "${BASH_REMATCH[1]}-${BASH_REMATCH[2]}.${BASH_REMATCH[3]}" | tr '[:upper:]' '[:lower:]')"
    FILES+=("$f"); KEYS+=("$key"); ok=$((ok+1))
  else
    echo "  SKIP (name does not match YYYY-MM-DD-view.ext): $base"
    bad=$((bad+1))
  fi
done < <(find "$SRC" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \) -print0 | sort -z)

echo
echo "Matched : $ok"
echo "Skipped : $bad"
echo
[[ $ok -eq 0 ]] && { echo "Nothing to upload."; exit 0; }

# What is already there, so --resume has something to compare against.
declare -a EXISTING=()
if [[ $RESUME -eq 1 ]]; then
  echo "Listing the bucket…"
  # NOT mapfile — macOS ships bash 3.2 and mapfile arrived in bash 4. It fails
  # with "command not found", EXISTING stays empty, and --resume silently
  # re-uploads everything while claiming to skip. Found exactly that way.
  while IFS= read -r line; do
    [[ -n "$line" ]] && EXISTING+=("$line")
  done < <("$WRANGLER" r2 object list "$BUCKET" --remote 2>/dev/null \
           | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z]+\.(jpg|jpeg|png)' | sort -u)
  echo "  ${#EXISTING[@]} object(s) already in the bucket"
  if [[ ${#EXISTING[@]} -eq 0 ]]; then
    echo "  (if that looks wrong, the listing failed — every file will be re-sent)"
  fi
  echo
fi
have(){ local k="$1"; for e in "${EXISTING[@]:-}"; do [[ "$e" == "$k" ]] && return 0; done; return 1; }

if [[ $GO -eq 0 ]]; then
  echo "First five keys that would be created:"
  for i in 0 1 2 3 4; do [[ $i -lt $ok ]] && echo "  $BUCKET/${KEYS[$i]}"; done
  echo
  echo "Dry run. Re-run with --go to upload."
  echo
  echo "Verify the command works with your wrangler version first:"
  echo
  echo "  $WRANGLER r2 object put \"$BUCKET/${KEYS[0]}\" --file \"${FILES[0]}\" --remote"
  echo
  exit 0
fi

echo "Uploading. Ctrl-C stops cleanly; anything already uploaded stays."
echo

fail=0; done_n=0; skipped=0
LOG="/tmp/upload-photos-errors.log"; : > "$LOG"

for i in "${!FILES[@]}"; do
  key="${KEYS[$i]}"; file="${FILES[$i]}"
  printf '[%3d/%3d] %-28s ' "$((i+1))" "$ok" "$key"

  if [[ $RESUME -eq 1 ]] && have "$key"; then
    echo "skip (already there)"; skipped=$((skipped+1)); continue
  fi

  # Up to three attempts with backoff. A single transient failure in a run of
  # 123 should not need a human.
  attempt=0; success=0
  while [[ $attempt -lt 3 ]]; do
    attempt=$((attempt+1))
    if err=$("$WRANGLER" r2 object put "$BUCKET/$key" --file "$file" --remote 2>&1); then
      success=1; break
    fi
    [[ $attempt -lt 3 ]] && sleep $((attempt*3))
  done

  if [[ $success -eq 1 ]]; then
    echo "ok$([[ $attempt -gt 1 ]] && echo " (attempt $attempt)")"
    done_n=$((done_n+1))
  else
    echo "FAILED"
    fail=$((fail+1))
    { echo "=== $key ==="; echo "$err"; echo; } >> "$LOG"
    # Show the first failure immediately — waiting until the end to find out
    # why is how 86 files failed silently last time.
    if [[ $fail -eq 1 ]]; then
      echo
      echo "  First failure, in full:"
      echo "$err" | sed 's/^/    /'
      echo
    fi
  fi

  # Pace it. Each call is a separate authenticated process; firing them as fast
  # as possible is what appears to have tripped the API on the first run.
  sleep 0.4
done

echo
echo "Done. $done_n uploaded, $skipped skipped, $fail failed."
[[ $fail -gt 0 ]] && echo "Errors written to $LOG"
[[ $fail -gt 0 ]] && echo "Re-run with --go --resume to retry only what is missing."
exit 0
