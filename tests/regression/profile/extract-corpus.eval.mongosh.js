const db = connect('mongodb://localhost:27017/jobs_watcher');
const coll = db.getCollection('job_lifecycle');

const total = coll.countDocuments();
const byStage = coll.aggregate([
  { $group: { _id: '$stage', count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray();
const byStatus = coll.aggregate([
  { $group: { _id: '$status', count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray();

print('=== job_lifecycle Overview ===');
print(`Total docs: ${total}`);
print('\nBy Stage:');
byStage.forEach(s => print(`  ${s._id}: ${s.count}`));
print('\nBy Status:');
byStatus.forEach(s => print(`  ${s._id}: ${s.count}`));

// enriched docs with company + role (candidates for corpus) — enriched-only
const candidates = coll.aggregate([
  { $match: { stage: 'full_parsed', status: 'enriched', company: { $ne: '' }, role: { $ne: '' } } },
  { $sort: { createdAt: -1 } },
  { $group: { _id: '$role', doc: { $first: '$$ROOT' } } },
  { $replaceRoot: { newRoot: '$doc' } },
  { $project: {
    _id: 1, company: 1, role: 1, description: 1, details: 1,
    salary: 1, location: 1, status: 1, url: 1, stage: 1, createdAt: 1
  } }
]).toArray();

print(`\n=== Corpus Candidates (full_parsed + enriched, deduped by role, latest createdAt) ===`);
print(`Total unique enriched roles: ${candidates.length}`);

let hasDetailsCount = 0;
candidates.forEach((doc, i) => {
  const detailKeys = doc.details
    ? Object.keys(doc.details).filter(k => typeof doc.details[k] === 'string' && doc.details[k].length > 0)
    : [];
  if (detailKeys.length > 0) hasDetailsCount++;
  const descLen = (doc.description || '').length;
  print(`\n[${i+1}] role: ${doc.role}`);
  print(`    company: ${doc.company}`);
  print(`    status: ${doc.status}`);
  print(`    stage: ${doc.stage}`);
  print(`    description: ${descLen} chars`);
  print(`    details fields populated: [${detailKeys.join(', ')}]`);
  print(`    salary: ${doc.salary || 'N/A'}`);
  print(`    location: ${doc.location || 'N/A'}`);
  print(`    createdAt: ${doc.createdAt}`);
});

print(`\n=== Summary ===`);
print(`Total enriched (full_parsed+enriched) with company+role: ${candidates.length}`);
print(`With populated details: ${hasDetailsCount}`);
print(`Without details: ${candidates.length - hasDetailsCount}`);
print('\nRecommendation: use all enriched candidates as corpus entries.');
