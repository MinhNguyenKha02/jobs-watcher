#!/usr/bin/env bash
set -Eeuo pipefail

command -v mongosh >/dev/null 2>&1 || {
    echo "error: mongosh is required" >&2
    exit 1
}

DB="jobs_watcher"
COLLECTION="job_lifecycle"

OUT_DIR="${1:-./backup}"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
OUT_FILE="${OUT_DIR}/${COLLECTION}-${TIMESTAMP}.json"

mkdir -p "$OUT_DIR"

mongosh "$DB" --quiet --eval '
const docs = db.getCollection("job_lifecycle").find({}).toArray();
print(EJSON.stringify(docs, null, 2));
' > "$OUT_FILE"

echo "exported: $OUT_FILE"