#!/usr/bin/env bash
set -euo pipefail

CORPUS_DIR="tests/regression/profile/corpus"
mkdir -p "$CORPUS_DIR"

mongosh --quiet --eval '
const db = connect("mongodb://localhost:27017/jobs_watcher");
const coll = db.getCollection("job_lifecycle");
const fs = require("fs");
const path = require("path");

const docs = coll.aggregate([
  { $match: { stage: "full_parsed", status: "enriched", company: { $ne: "" }, role: { $ne: "" } } },
  { $sort: { createdAt: -1 } },
  { $group: { _id: "$role", doc: { $first: "$$ROOT" } } },
  { $replaceRoot: { newRoot: "$doc" } },
  { $project: {
    _id: 1, company: 1, role: 1, description: 1, details: 1,
    salary: 1, location: 1, url: 1, status: 1, createdAt: 1
  } }
]).toArray();

const corpusDir = "'"$CORPUS_DIR"'";
let count = 0;
const seen = {};

for (const doc of docs) {
  let slug = doc.role
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) slug = "unknown-role";

  if (seen[slug]) {
    seen[slug]++;
    slug = slug + "-" + seen[slug];
  } else {
    seen[slug] = 1;
  }

  const outPath = path.join(corpusDir, slug + ".json");
  const output = {
    _id: doc._id,
    company: doc.company,
    role: doc.role,
    description: doc.description || "",
    details: doc.details || {},
    salary: doc.salary || "",
    location: doc.location || "",
    url: doc.url || "",
    createdAt: doc.createdAt
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  count++;
  print("Wrote " + outPath);
}

print("\nExtracted " + count + " corpus files to " + corpusDir);
'
