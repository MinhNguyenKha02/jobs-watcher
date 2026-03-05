// scripts/export-e2e-output.ts
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config.js';
import { ensureE2EOutputDir, getE2EOutputDirRelativeToRoot } from '../src/utils/e2e-output-path.js';

// Sanitize function to remove large/raw fields
function sanitizeForExport(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  // Remove or summarize large fields
  if (clone.payload?.body?.data && typeof clone.payload.body.data === 'string' && clone.payload.body.data.length > 200) {
    clone.payload.body.data = `[base64 data, length=${clone.payload.body.data.length}]`;
  }
  if (clone.body && typeof clone.body === 'string' && clone.body.length > 500) {
    clone.body = `[html string, length=${clone.body.length}]`;
  }
  if (clone.rawContent && typeof clone.rawContent === 'string' && clone.rawContent.length > 500) {
    clone.rawContent = `[raw content, length=${clone.rawContent.length}]`;
  }
  if (clone.original) {
    clone.original = sanitizeForExport(clone.original);
  }
  return clone;
}

async function exportE2EOutput() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('Missing MONGODB_URI');
  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const db = mongo.db(config.mongodb.dbName);
  
  const outputDir = ensureE2EOutputDir();
  
  // Export all collections with sanitization
  const jobQueue = await db.collection('job_queue').find({}).toArray();
  const jobTrash = await db.collection('job_trash').find({}).toArray();
  const needsEnrichment = await db.collection('needs_enrichment').find({}).toArray();
  const actionLog = await db.collection('action_log').find({}).sort({ timestamp: -1 }).limit(1000).toArray();
  const parseLog = await db.collection('parse_log').find({}).sort({ timestamp: -1 }).limit(1000).toArray();
  const rawIngest = await db.collection('raw_ingest').find({}).sort({ timestamp: -1 }).limit(100).toArray();
  const metrics = await db.collection('metrics').find({}).toArray();
  
  // Sanitize all exports
  const sanitizedQueue = jobQueue.map(sanitizeForExport);
  const sanitizedTrash = jobTrash.map(sanitizeForExport);
  const sanitizedEnrichment = needsEnrichment.map(sanitizeForExport);
  const sanitizedActionLog = actionLog.map(sanitizeForExport);
  const sanitizedParseLog = parseLog.map(sanitizeForExport);
  const sanitizedRawIngest = rawIngest.map(sanitizeForExport);
  const sanitizedMetrics = metrics.map(sanitizeForExport);
  
  // Write sanitized exports with integrity validation
  const exports = [
    { file: 'e2e-job-queue.json', data: sanitizedQueue, minCount: 0 },
    { file: 'e2e-job-trash.json', data: sanitizedTrash, minCount: 0 },
    { file: 'e2e-needs-enrichment.json', data: sanitizedEnrichment, minCount: 0 },
    { file: 'e2e-action-log.json', data: sanitizedActionLog, minCount: 0 },
    { file: 'e2e-parse-log.json', data: sanitizedParseLog, minCount: 0 },
    { file: 'e2e-raw-ingest.json', data: sanitizedRawIngest, minCount: 0 },
    { file: 'e2e-metrics.json', data: sanitizedMetrics, minCount: 0 },
  ];
  
  const writeResults: Record<string, { success: boolean; count: number; path: string }> = {};
  
  for (const exp of exports) {
    const filePath = path.join(outputDir, exp.file);
    try {
      fs.writeFileSync(filePath, JSON.stringify(exp.data, null, 2));
      const stat = fs.statSync(filePath);
      writeResults[exp.file] = {
        success: true,
        count: exp.data.length,
        path: filePath,
      };
      console.log(`[E2E Export] ✅ Wrote ${exp.file}: ${exp.data.length} records (${(stat.size / 1024).toFixed(2)}KB)`);
    } catch (err) {
      writeResults[exp.file] = {
        success: false,
        count: 0,
        path: filePath,
      };
      console.error(`[E2E Export] ❌ Failed to write ${exp.file}:`, err);
    }
  }
  
  // Generate comprehensive summary report with parse log analysis
  const totalProcessed = sanitizedQueue.length + sanitizedTrash.length;
  const parseSuccesses = sanitizedParseLog.filter((l: any) => l.success).length;
  const parseFailures = sanitizedParseLog.filter((l: any) => !l.success).length;
  const totalParseAttempts = parseSuccesses + parseFailures;
  
  // Calculate parse rate from parse_log if available, otherwise fall back to queue/trash ratio
  const parseSuccessRate = totalParseAttempts > 0 
    ? (parseSuccesses / totalParseAttempts) * 100 
    : (totalProcessed > 0 ? (sanitizedQueue.length / totalProcessed) * 100 : 0);
  const trashRate = totalProcessed > 0 ? (sanitizedTrash.length / totalProcessed) * 100 : 0;
  const enrichmentRate = totalProcessed > 0 ? (sanitizedEnrichment.length / totalProcessed) * 100 : 0;
  
  const actionErrors = sanitizedActionLog.filter((l: any) => l.level === 'error').length;
  
  const summary = {
    exportedAt: new Date().toISOString(),
    processingSummary: {
      totalJobsProcessed: totalProcessed,
      queuedJobs: sanitizedQueue.length,
      trashedJobs: sanitizedTrash.length,
      parseSuccessRate: parseSuccessRate.toFixed(2) + '%',
      trashRate: trashRate.toFixed(2) + '%',
      enrichmentRate: enrichmentRate.toFixed(2) + '%',
    },
    collections: {
      job_queue: { count: sanitizedQueue.length, statuses: {} as Record<string, number> },
      job_trash: { count: sanitizedTrash.length, reasons: {} as Record<string, number> },
      needs_enrichment: { count: sanitizedEnrichment.length, reasons: {} as Record<string, number> },
      action_log: { count: sanitizedActionLog.length, errorCount: actionErrors },
      parse_log: { 
        count: sanitizedParseLog.length, 
        stages: {} as Record<string, number>, 
        successCount: parseSuccesses,
        failureCount: parseFailures,
        totalAttempts: totalParseAttempts,
        parseRate: totalParseAttempts > 0 ? ((parseSuccesses / totalParseAttempts) * 100).toFixed(2) + '%' : 'N/A'
      },
      raw_ingest: { count: sanitizedRawIngest.length },
      metrics: { count: sanitizedMetrics.length },
    },
    dataIntegrity: {
      allFilesWritten: Object.values(writeResults).every(r => r.success),
      filesWithData: Object.entries(writeResults)
        .filter(([_, r]) => r.success && r.count > 0)
        .map(([file, r]) => `${file} (${r.count} records)`),
      emptyFiles: Object.entries(writeResults)
        .filter(([_, r]) => r.success && r.count === 0)
        .map(([file]) => file),
    },
    exitCriteria: {
      hasQueuedJobs: sanitizedQueue.length > 0,
      hasValidParseLogs: parseSuccesses > 0,
      noUnexpectedErrors: actionErrors === 0,
      enrichmentDataAvailable: sanitizedEnrichment.length > 0,
      metricsCollected: sanitizedMetrics.length > 0,
      parsedJobsExist: totalProcessed > 0,
    },
    mvpAcceptanceCriteria: {
      minimumQueuedJobs: sanitizedQueue.length >= 10,
      minimumJobsProcessed: totalProcessed >= 50,
      acceptableParsedRate: parseSuccessRate >= 50,
      hasLoggingData: sanitizedActionLog.length > 0 || sanitizedParseLog.length > 0,
      enrichmentReady: sanitizedEnrichment.length > 0,
    },
    parseFailureAnalysis: {
      parseLogFailureReasons: {} as Record<string, number>,
      trashParseErrors: {} as Record<string, number>,
    },
  };
  
  // Calculate statistics
  sanitizedQueue.forEach((j: any) => {
    const status = j.status || 'unknown';
    summary.collections.job_queue.statuses[status] = (summary.collections.job_queue.statuses[status] || 0) + 1;
  });
  
  sanitizedTrash.forEach((t: any) => {
    const reason = t.reason || 'unknown';
    summary.collections.job_trash.reasons[reason] = (summary.collections.job_trash.reasons[reason] || 0) + 1;
  });

  sanitizedEnrichment.forEach((e: any) => {
    const reason = e.reason || 'unknown';
    summary.collections.needs_enrichment.reasons[reason] = (summary.collections.needs_enrichment.reasons[reason] || 0) + 1;
  });
  
  sanitizedParseLog.forEach((p: any) => {
    const stage = p.stage || 'unknown';
    summary.collections.parse_log.stages[stage] = (summary.collections.parse_log.stages[stage] || 0) + 1;
    if (!p.success && p.error?.message) {
      const key = String(p.error.message);
      summary.parseFailureAnalysis.parseLogFailureReasons[key] =
        (summary.parseFailureAnalysis.parseLogFailureReasons[key] || 0) + 1;
    }
  });

  sanitizedTrash.forEach((t: any) => {
    const parseErrors = Array.isArray(t.parseErrors) ? t.parseErrors : [];
    parseErrors.forEach((reason: string) => {
      summary.parseFailureAnalysis.trashParseErrors[reason] =
        (summary.parseFailureAnalysis.trashParseErrors[reason] || 0) + 1;
    });
  });
  
  try {
    fs.writeFileSync(path.join(outputDir, 'e2e-summary.json'), JSON.stringify(summary, null, 2));
    console.log(`[E2E Export] ✅ Wrote e2e-summary.json`);
  } catch (err) {
    console.error(`[E2E Export] ❌ Failed to write e2e-summary.json:`, err);
  }
  
  await mongo.close();
  
  console.log('\n' + '='.repeat(80));
  console.log('[E2E Export] ✅ Export complete');
  console.log('='.repeat(80));
  
  console.log('\n📊 PROCESSING SUMMARY:');
  console.log(`  Total Jobs Processed: ${summary.processingSummary.totalJobsProcessed}`);
  console.log(`  Queued: ${summary.processingSummary.queuedJobs} | Trashed: ${summary.processingSummary.trashedJobs}`);
  console.log(`  Parse Success Rate: ${summary.processingSummary.parseSuccessRate}`);
  
  console.log('\n📦 COLLECTION COUNTS:');
  console.log(`  - job_queue: ${summary.collections.job_queue.count} (${JSON.stringify(summary.collections.job_queue.statuses)})`);
  console.log(`  - job_trash: ${summary.collections.job_trash.count} (${JSON.stringify(summary.collections.job_trash.reasons)})`);
  console.log(`  - needs_enrichment: ${summary.collections.needs_enrichment.count} (${JSON.stringify(summary.collections.needs_enrichment.reasons)})`);
  console.log(`  - action_log: ${summary.collections.action_log.count} (errors: ${summary.collections.action_log.errorCount})`);
  console.log(`  - parse_log: ${summary.collections.parse_log.count} (${JSON.stringify(summary.collections.parse_log.stages)}, successes: ${summary.collections.parse_log.successCount})`);
  console.log(`  - raw_ingest: ${summary.collections.raw_ingest.count}`);
  console.log(`  - metrics: ${summary.collections.metrics.count}`);
  
  console.log('\n🔍 DATA INTEGRITY:');
  console.log(`  All Files Written: ${summary.dataIntegrity.allFilesWritten ? '✅' : '❌'}`);
  if (summary.dataIntegrity.filesWithData.length > 0) {
    console.log(`  Files with Data: ${summary.dataIntegrity.filesWithData.join(', ')}`);
  }
  if (summary.dataIntegrity.emptyFiles.length > 0) {
    console.log(`  Empty Files: ${summary.dataIntegrity.emptyFiles.join(', ')}`);
  }
  
  console.log('\n✅ EXIT CRITERIA:');
  console.log(`  Has queued jobs: ${summary.exitCriteria.hasQueuedJobs ? '✅' : '❌'}`);
  console.log(`  Has valid parse logs: ${summary.exitCriteria.hasValidParseLogs ? '✅' : '❌'}`);
  console.log(`  No unexpected errors: ${summary.exitCriteria.noUnexpectedErrors ? '✅' : '❌'}`);
  console.log(`  Enrichment data available: ${summary.exitCriteria.enrichmentDataAvailable ? '✅' : '❌'}`);
  console.log(`  Metrics collected: ${summary.exitCriteria.metricsCollected ? '✅' : '❌'}`);
  console.log(`  Parsed jobs exist: ${summary.exitCriteria.parsedJobsExist ? '✅' : '❌'}`);
  
  console.log('\n🎯 MVP ACCEPTANCE CRITERIA:');
  const mvpCriteria = summary.mvpAcceptanceCriteria;
  const mvpMet = Object.values(mvpCriteria).filter(v => v === true).length;
  const mvpTotal = Object.values(mvpCriteria).length;
  console.log(`  Minimum Queued Jobs (≥10): ${mvpCriteria.minimumQueuedJobs ? '✅' : '❌'} (${summary.processingSummary.queuedJobs})`);
  console.log(`  Minimum Jobs Processed (≥50): ${mvpCriteria.minimumJobsProcessed ? '✅' : '❌'} (${summary.processingSummary.totalJobsProcessed})`);
  console.log(`  Acceptable Parse Rate (≥50%): ${mvpCriteria.acceptableParsedRate ? '✅' : '❌'} (${summary.processingSummary.parseSuccessRate})`);
  console.log(`  Has Logging Data: ${mvpCriteria.hasLoggingData ? '✅' : '❌'}`);
  console.log(`  Enrichment Ready: ${mvpCriteria.enrichmentReady ? '✅' : '❌'}`);
  console.log(`\n  Overall MVP Score: ${mvpMet}/${mvpTotal} criteria met`);
  
  console.log(`\n📁 EXPORT LOCATION: ${getE2EOutputDirRelativeToRoot()}/`);
  console.log('='.repeat(80) + '\n');
}

exportE2EOutput().catch((err) => {
  console.error('[E2E Export] ❌ Export failed:', err);
  process.exit(1);
});
