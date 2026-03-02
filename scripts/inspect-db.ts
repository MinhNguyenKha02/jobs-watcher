#!/usr/bin/env tsx
/**
 * MongoDB Inspection Script
 * 
 * Provides human-readable summaries of all collections for manual inspection.
 * Use: npm run inspect:db
 * 
 * Outputs:
 * - Collection counts
 * - Sample documents (sanitized)
 * - Exit criteria checks
 * - Recommendations for fixture improvements
 */
import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';

function sanitize(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  if (clone.payload?.body?.data && typeof clone.payload.body.data === 'string' && clone.payload.body.data.length > 200) {
    clone.payload.body.data = `[base64 ${clone.payload.body.data.length}B]`;
  }
  if (clone.body && typeof clone.body === 'string' && clone.body.length > 500) {
    clone.body = `[html ${clone.body.length}B]`;
  }
  if (clone.rawContent && typeof clone.rawContent === 'string' && clone.rawContent.length > 500) {
    clone.rawContent = `[raw ${clone.rawContent.length}B]`;
  }
  return clone;
}

async function inspectDB() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }

  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  console.log('✅ Connected to MongoDB\n');

  const db = mongo.db(config.mongodb.dbName);
  const collections = ['job_queue', 'job_trash', 'action_log', 'parse_log', 'raw_ingest', 'metrics'];

  console.log('📊 COLLECTION OVERVIEW\n' + '='.repeat(80));

  for (const collName of collections) {
    const coll = db.collection(collName);
    const count = await coll.countDocuments();
    console.log(`\n📦 ${collName}: ${count} documents`);

    if (count === 0) {
      console.log('   (empty)');
      continue;
    }

    // Show sample
    const sample = await coll.findOne({}, { sort: { _id: -1 } });
    console.log('   Sample (latest):');
    console.log('   ' + JSON.stringify(sanitize(sample), null, 2).split('\n').join('\n   '));

    // Collection-specific insights
    if (collName === 'job_queue') {
      const statuses = await coll.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]).toArray();
      console.log('   Status breakdown:', statuses.map(s => `${s._id}: ${s.count}`).join(', '));
    } else if (collName === 'job_trash') {
      const reasons = await coll.aggregate([
        { $group: { _id: '$reason', count: { $sum: 1 } } },
      ]).toArray();
      console.log('   Trash reasons:', reasons.map(r => `${r._id}: ${r.count}`).join(', '));
    } else if (collName === 'parse_log') {
      const stages = await coll.aggregate([
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]).toArray();
      console.log('   Parse stages:', stages.map(s => `${s._id}: ${s.count}`).join(', '));
    }
  }

  console.log('\n\n🎯 EXIT CRITERIA CHECK\n' + '='.repeat(80));

  const jobQueue = await db.collection('job_queue').find({}).toArray();
  const jobTrash = await db.collection('job_trash').find({}).toArray();
  const parseLog = await db.collection('parse_log').find({}).toArray();

  const checks = {
    '✅ Has queued jobs': jobQueue.length > 0,
    '✅ All queued jobs have messageId': jobQueue.every(j => j.messageId),
    '✅ All queued jobs have matchScore': jobQueue.every(j => typeof j.matchScore === 'number'),
    '✅ No jobs with missing enrichment in trash': jobTrash.filter(t => t.reason === 'missing_enrichment').length === 0,
    '✅ Parse logs have success cases': parseLog.filter(p => p.success).length > 0,
    '⚠️  No large buffers in trash': !JSON.stringify(jobTrash).includes('_isBuffer'),
  };

  for (const [check, passed] of Object.entries(checks)) {
    console.log(`${passed ? '✅' : '❌'} ${check.replace(/^[✅❌⚠️]\s+/, '')}`);
  }

  console.log('\n\n💡 RECOMMENDATIONS\n' + '='.repeat(80));

  if (jobQueue.length === 0) {
    console.log('❗ No jobs in queue. Add more diverse fixtures to tests/__fixtures__/emails.ts');
  }

  const trashReasons = jobTrash.reduce((acc, t) => {
    acc[t.reason] = (acc[t.reason] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (trashReasons.filtered_by_hybrid > 0) {
    console.log(`⚠️  ${trashReasons.filtered_by_hybrid} jobs filtered. Review filter criteria or add junior-friendly fixtures.`);
  }

  if (trashReasons.parse_failed_or_filtered > 0) {
    console.log(`⚠️  ${trashReasons.parse_failed_or_filtered} jobs failed parsing. Review parser logic or add better HTML fixtures.`);
  }

  const avgMatchScore = jobQueue.length > 0
    ? jobQueue.reduce((sum, j) => sum + (j.matchScore || 0), 0) / jobQueue.length
    : 0;

  console.log(`\n📈 Average match score: ${avgMatchScore.toFixed(2)}%`);
  if (avgMatchScore < 50) {
    console.log('💡 Low match scores. Consider adding fixtures with skills matching your profile.');
  }

  await mongo.close();
  console.log('\n✅ Inspection complete');
}

inspectDB().catch(err => {
  console.error('❌ Inspection failed:', err);
  process.exit(1);
});
