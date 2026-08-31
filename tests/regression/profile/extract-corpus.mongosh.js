// extract-corpus.mongosh.js
// Extracts deduped-by-role corpus JSON files from job_lifecycle (full_parsed)
// Writes directly to regression/corpus/ directory
//
// Usage: mongosh --quiet src/services/profile/tests/extract-corpus.mongosh.js [-- --limit 20]

const LIMIT = typeof limit !== 'undefined' ? parseInt(limit) : 20;
const OUT_DIR = typeof outdir !== 'undefined' ? outdir : 'tests/regression/profile/corpus';

const fs = require('fs');
const path = require('path');

fs.mkdirSync(OUT_DIR, { recursive: true });

const db = connect('mongodb://localhost:27017/jobs_watcher');
const coll = db.getCollection('job_lifecycle');

const candidates = coll.aggregate([
  { $match: { stage: 'full_parsed', company: { $ne: '' }, role: { $ne: '' } } },
  { $addFields: { hasContent: { $or: [ { $ne: ['$description', ''] }, { $ne: ['$details', null] } ] } } },
  { $match: { hasContent: true } },
  { $sort: { createdAt: -1 } },
  { $project: { _id: 1, company: 1, role: 1, description: 1, details: 1, salary: 1, location: 1, url: 1, status: 1, createdAt: 1 } }
]).toArray();

const seen = {};
let count = 0;

for (const doc of candidates) {
  const key = doc.role.toLowerCase().trim();
  if (seen[key]) continue;
  seen[key] = true;
  if (count >= LIMIT) break;
  count++;

  const slug = doc.role.toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const output = {
    _id: doc._id,
    company: doc.company,
    role: doc.role,
    description: doc.description || '',
    details: doc.details || {},
    salary: doc.salary || '',
    location: doc.location || '',
    url: doc.url || '',
    createdAt: doc.createdAt
  };

  const filePath = path.join(OUT_DIR, `${slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  print(`Wrote: ${slug}.json  (${doc.company} - ${doc.role})`);
}

print(`\nDone. Extracted ${count} corpus files to ${OUT_DIR}`);
