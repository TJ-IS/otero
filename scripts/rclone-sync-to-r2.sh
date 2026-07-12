#!/usr/bin/env bash
# Copy missing objects from source S3-compatible storage (old MinIO) → Cloudflare R2.
#
# By default skips MinerU dumps we no longer keep (same policy as
# fulltextService.pruneUnusedMineruFiles):
#   layout.json, *_model.json, *_origin.pdf
#
# Required env (or export before run):
#   SOURCE_S3_ENDPOINT   e.g. api-minio.wtf-is.eu.cc   (no https://)
#   SOURCE_S3_ACCESS_KEY
#   SOURCE_S3_SECRET_KEY
#   SOURCE_S3_BUCKET     default: otero-pdfs
#
# Destination is read from project .env (S3_* → R2).
#
# Usage:
#   # dry-run (no writes)
#   SOURCE_S3_ENDPOINT=... SOURCE_S3_ACCESS_KEY=... SOURCE_S3_SECRET_KEY=... \
#     ./scripts/rclone-sync-to-r2.sh --dry-run
#
#   # resume full copy (skips existing + skipped MinerU dumps)
#   ... ./scripts/rclone-sync-to-r2.sh
#
#   # only useful fulltext JSON (content_list*), not layout/model
#   ... ./scripts/rclone-sync-to-r2.sh --json-only
#
#   # if you really need the dumps: ... ./scripts/rclone-sync-to-r2.sh --keep-mineru-dumps
#set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RCLONE="${RCLONE:-$(command -v rclone || true)}"
if [[ -z "$RCLONE" && -x "$HOME/.local/bin/rclone" ]]; then
  RCLONE="$HOME/.local/bin/rclone"
fi
if [[ -z "$RCLONE" ]]; then
  echo "rclone not found. Install: https://rclone.org/install/" >&2
  exit 1
fi

# Load project .env for R2 (S3_*) without clobbering already-exported vars.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^(S3_|STORAGE_)' "$ROOT/.env" | sed 's/\r$//' || true)
  set +a
fi

SRC_ENDPOINT="${SOURCE_S3_ENDPOINT:?set SOURCE_S3_ENDPOINT (host only, no scheme)}"
SRC_ACCESS="${SOURCE_S3_ACCESS_KEY:?set SOURCE_S3_ACCESS_KEY}"
SRC_SECRET="${SOURCE_S3_SECRET_KEY:?set SOURCE_S3_SECRET_KEY}"
SRC_BUCKET="${SOURCE_S3_BUCKET:-otero-pdfs}"
SRC_SSL="${SOURCE_S3_USE_SSL:-true}"

DST_ENDPOINT="${S3_ENDPOINT:?S3_ENDPOINT missing in .env}"
DST_ACCESS="${S3_ACCESS_KEY:?S3_ACCESS_KEY missing in .env}"
DST_SECRET="${S3_SECRET_KEY:?S3_SECRET_KEY missing in .env}"
DST_BUCKET="${S3_BUCKET:-otero-pdfs}"

CONF="$(mktemp -t otero-rclone.XXXXXX.conf)"
cleanup() { rm -f "$CONF"; }
trap cleanup EXIT

cat >"$CONF" <<EOF
[src]
type = s3
provider = Minio
env_auth = false
access_key_id = ${SRC_ACCESS}
secret_access_key = ${SRC_SECRET}
endpoint = https://${SRC_ENDPOINT}
force_path_style = true
region = us-east-1
# Required for many MinIO / nginx gateways with rclone's AWS SDK v2 signer.
sign_accept_encoding = false
acl = private
no_check_bucket = true

[r2]
type = s3
provider = Cloudflare
env_auth = false
access_key_id = ${DST_ACCESS}
secret_access_key = ${DST_SECRET}
endpoint = https://${DST_ENDPOINT}
acl = private
no_check_bucket = true
region = auto
EOF

# If SOURCE_S3_USE_SSL=false, strip https:// from src endpoint
if [[ "$SRC_SSL" != "true" ]]; then
  sed -i "s|^endpoint = https://${SRC_ENDPOINT}\$|endpoint = http://${SRC_ENDPOINT}|" "$CONF"
fi

echo "rclone: $("$RCLONE" version | head -1)"
echo "src: ${SRC_ENDPOINT}/${SRC_BUCKET}  →  r2: ${DST_ENDPOINT}/${DST_BUCKET}"
echo "checking remotes..."
"$RCLONE" --config "$CONF" lsd "src:${SRC_BUCKET}" >/dev/null
"$RCLONE" --config "$CONF" lsd "r2:${DST_BUCKET}" >/dev/null
echo "remotes OK"

EXTRA=()
DRY=0
KEEP_DUMPS=0
JSON_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1; EXTRA+=(--dry-run) ;;
    --keep-mineru-dumps) KEEP_DUMPS=1 ;;
    --json-only) JSON_ONLY=1 ;;
    *) EXTRA+=("$arg") ;;
  esac
done

FILTERS=()
if [[ "$JSON_ONLY" -eq 1 ]]; then
  # First-match filter rules (rclone --filter). Keep content_list JSON only;
  # drop layout / model / origin dumps and everything else.
  FILTERS+=(
    --filter '- **/layout.json'
    --filter '- **/*_model.json'
    --filter '- **/*_origin.pdf'
    --filter '+ **/fulltext/**content_list*.json'
    --filter '- **'
  )
  echo "json-only: **/fulltext/**content_list*.json (excludes layout/model/origin)"
elif [[ "$KEEP_DUMPS" -eq 0 ]]; then
  # Match fulltextService.pruneUnusedMineruFiles / migrate-fulltext-to-minio.
  FILTERS+=(
    --filter '- **/layout.json'
    --filter '- **/*_model.json'
    --filter '- **/*_origin.pdf'
  )
  echo "excluding: layout.json, *_model.json, *_origin.pdf"
fi

# --ignore-existing: skip keys already on R2 (safe resume after Super Slurper)
# Keep transfers modest so the flaky source is less likely to 5xx.
CMD=(
  "$RCLONE" --config "$CONF" copy
  "src:${SRC_BUCKET}" "r2:${DST_BUCKET}"
  --ignore-existing
  --transfers 4
  --checkers 8
  --retries 10
  --low-level-retries 20
  --retries-sleep 5s
  --timeout 5m
  --contimeout 60s
  --stats 30s
  --stats-one-line
  --log-level INFO
  "${FILTERS[@]}"
  "${EXTRA[@]}"
)

echo "running: ${CMD[*]}"
if [[ "$DRY" -eq 1 ]]; then
  echo "(dry-run: no objects will be written)"
fi
"${CMD[@]}"
echo "done."
