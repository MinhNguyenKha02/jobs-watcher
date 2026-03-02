#!/usr/bin/env tsx
/**
 * Logs Inspection Script
 * 
 * Reads and pretty-prints logs from MongoDB collections in reverse chronological order.
 * Helps identify issues and starvation points in the feedback loop.
 * 
 * Use: npm run inspect:logs
 */
import { MongoClient } from 'mongodb';
import { config } from '../src/config.js';

function formatLog(log: any): string {
  const timestamp = log.timestamp ? new Date(log.timestamp).toISOString() : 'N/A';
  const level = log.level || 'INFO';
  const message = log.message || log.event || '';
  const details = Object.keys(log)
    .filter(k => !['_id', 'timestamp', 'level', 'message', 'event'].includes(k))
    .map(k => `${k}=${JSON.stringify(log[k]).substring(0, 100)}`)
    .join(' ');

  const formatted = `${timestamp} [${level}] ${message} ${details}`.trim();
  return formatted;
}

async function inspectLogs() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }

  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const db = mongo.db(config.mongodb.dbName);

  const limit = parseInt(process.argv[2] || '50', 10);

  console.log(`📋 RECENT LOGS (last ${limit})\n${'='.repeat(120)}\n`);

  // Action Log (operational events)
  console.log('📍 ACTION LOG');
  console.log('-'.repeat(120));
  const actionLogs = await db.collection('action_log')
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  if (actionLogs.length === 0) {
    console.log('(empty)');
  } else {
    actionLogs.forEach(log => console.log(formatLog(log)));
  }

  // Parse Log (parse events with success/failure)
  console.log('\n\n📝 PARSE LOG');
  console.log('-'.repeat(120));
  const parseLogs = await db.collection('parse_log')
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  if (parseLogs.length === 0) {
    console.log('(empty)');
  } else {
    parseLogs.forEach(log => {
      const icon = log.success ? '✅' : '❌';
      console.log(`${icon} ${formatLog(log)}`);
    });
  }

  // Raw Ingest Log (raw email ingestion)
  console.log('\n\n📨 RAW INGEST LOG');
  console.log('-'.repeat(120));
  const rawLogs = await db.collection('raw_ingest')
    .find({})
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();

  if (rawLogs.length === 0) {
    console.log('(empty)');
  } else {
    rawLogs.forEach(log => console.log(formatLog(log)));
  }

  // Statistics
  console.log('\n\n📊 LOG STATISTICS');
  console.log('='.repeat(120));

  const stats = {
    actionLog: await db.collection('action_log').countDocuments(),
    parseLog: await db.collection('parse_log').countDocuments(),
    parseSuccess: await db.collection('parse_log').countDocuments({ success: true }),
    parseFailed: await db.collection('parse_log').countDocuments({ success: false }),
    rawIngest: await db.collection('raw_ingest').countDocuments(),
  };

  console.log(`Action Log entries: ${stats.actionLog}`);
  console.log(`Parse Log entries: ${stats.parseLog} (✅ ${stats.parseSuccess}, ❌ ${stats.parseFailed})`);
  console.log(`Raw Ingest entries: ${stats.rawIngest}`);
  console.log(`Parse success rate: ${stats.parseLog > 0 ? ((stats.parseSuccess / stats.parseLog) * 100).toFixed(1) : 'N/A'}%`);

  await mongo.close();
  console.log('\n✅ Log inspection complete');
}

inspectLogs().catch(err => {
  console.error('❌ Log inspection failed:', err);
  process.exit(1);
});

