
import { MongoClient } from 'mongodb';
import { config } from '../../../config.js';
import { MemoryMonitor } from '../../outbound/monitoring/memory-monitor.js';

async function printStats() {
  const memoryMonitor = new MemoryMonitor({
    warningThresholdMb: 1500,
    criticalThresholdMb: 1800,
    cpuWarningThresholdPercent: 70,
    cpuCriticalThresholdPercent: 90,
  });
  const mongo = new MongoClient(config.mongodb.uri);
  await mongo.connect();
  try {
    const db = mongo.db(config.mongodb.dbName);
    const snap = memoryMonitor.snapshot();
    const [rawIngestCount, queuedCount, needsEnrichmentCount, trashedCount] = await Promise.all([
      db.collection('raw_ingest').countDocuments(),
      db.collection('job_queue').countDocuments({ status: 'queued' }),
      db.collection('needs_enrichment').countDocuments({ status: { $in: ['pending', 'retry_requested'] } }),
      db.collection('job_trash').countDocuments(),
    ]);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentJobs = await db.collection('raw_ingest').countDocuments({ ingestedAt: { $gte: oneDayAgo } });
    const processingRate = Math.round(recentJobs / 24);
    console.log('📊 Jobs Watcher Stats');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`Memory (RSS):     ${snap.rssMb.toFixed(1)} MB`);
    console.log(`Heap Used:        ${snap.heapUsedMb.toFixed(1)} / ${snap.heapTotalMb.toFixed(1)} MB`);
    console.log(`CPU Usage:        ${snap.cpuPercent?.toFixed(1) ?? 'N/A'}%`);
    console.log(`Uptime:           ${Math.floor(process.uptime() / 60)} min`);
    console.log();
    console.log(`Raw Ingested:     ${rawIngestCount}`);
    console.log(`Queued:           ${queuedCount}`);
    console.log(`Needs Enrichment: ${needsEnrichmentCount}`);
    console.log(`Trashed:          ${trashedCount}`);
    console.log(`Processing Rate:  ${processingRate} jobs/hour`);
    console.log('─────────────────────────────────────────────────────────────────────');
  } finally {
    await mongo.close();
  }
}

async function printLogs(days: number) {
  const mongo = new MongoClient(config.mongodb.uri);
  await mongo.connect();
  try {
    const db = mongo.db(config.mongodb.dbName);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    console.log(`📋 RECENT LOGS (last ${days} days)`);
    console.log('='.repeat(80));
    const actionLogs = await db.collection('action_log')
      .find({ timestamp: { $gte: cutoff } })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();
    if (actionLogs.length === 0) {
      console.log('(empty)');
    } else {
      actionLogs.forEach(log => {
        const ts = log.timestamp ? new Date(log.timestamp).toISOString() : 'N/A';
        const msg = log.message || log.event || '';
        console.log(`${ts} ${msg}`);
      });
    }
    console.log('='.repeat(80));
  } finally {
    await mongo.close();
  }
}

function printUsage() {
  console.log(`\nJobs Watcher Monitoring CLI\n\nUsage:\n  npx tsx src/cli/monitor.ts [command]\n\nCommands:\n  stats             Show performance statistics\n  logs [days]       Show recent actions (default: 7 days)\n  help              Show this help message\n\nExamples:\n  npx tsx src/cli/monitor.ts stats\n  npx tsx src/cli/monitor.ts logs 30\n`);
}

// Parse arguments
const command = process.argv[2];

(async () => {
  if (command === 'stats') {
    await printStats();
  } else if (command === 'logs') {
    const days = parseInt(process.argv[3] || '7');
    await printLogs(days);
  } else if (command === 'help' || command === '--help' || command === '-h') {
    printUsage();
  } else {
    // Default: show stats
    await printStats();
  }
})();


