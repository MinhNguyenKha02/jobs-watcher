#!/usr/bin/env bash
set -Eeuo pipefail

FILE="${1:?usage: $0 <./backup/json.ejson>}"

MONGO_IMPORT_FILE="$FILE" mongosh jobs_watcher --quiet --eval '
const fs = require("fs");

const docs = EJSON.parse(
    fs.readFileSync(process.env.MONGO_IMPORT_FILE, "utf8")
);

db.job_lifecycle.insertMany(docs);
'

echo "imported: $FILE"