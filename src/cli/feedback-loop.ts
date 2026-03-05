#!/usr/bin/env tsx

/**
 * Feedback Loop - Daily Compliance and Performance Checks
 *
 * Runs comprehensive checks on the system:
 * - E2E output compliance (no data loss)
 * - Performance metrics
 * - Error rate analysis
 * - Resource usage trends
 * - Recommendations for improvements
 */

import fs from 'fs';
import path from 'path';

import { MongoClient } from 'mongodb';

import { config } from '../config.js';
import { getLogger } from '../services/logger.js';
import { getE2EOutputDir, getE2EOutputDirRelativeToRoot } from '../utils/e2e-output-path.js';

const logger = getLogger();

interface ComplianceReport {
  timestamp: string;
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: any;
  }[];
  recommendations: string[];
  summary: {
    passed: number;
    warned: number;
    failed: number;
  };
}

async function checkE2EOutputCompliance(): Promise<ComplianceReport['checks'][0]> {
  const outputDir = getE2EOutputDir();
  const relativeOutputDir = getE2EOutputDirRelativeToRoot();
  const requiredFiles = [
    'e2e-raw-ingest.json',
    'e2e-job-queue.json',
    'e2e-job-trash.json',
    'e2e-needs-enrichment.json',
    'e2e-parse-log.json',
  ];

  if (!fs.existsSync(outputDir)) {
    return {
      name: 'E2E Output Directory',
      status: 'warn',
      message: `E2E output directory does not exist: ${relativeOutputDir}`,
      details: { path: relativeOutputDir },
    };
  }

  const missing = requiredFiles.filter((name) => !fs.existsSync(path.join(outputDir, name)));
  if (missing.length > 0) {
    return {
      name: 'E2E Output Files',
      status: 'fail',
      message: `Missing required E2E output files: ${missing.join(', ')}`,
      details: { missing },
    };
  }

  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'e2e-raw-ingest.json'), 'utf-8')
    ) as any[];
    const queue = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'e2e-job-queue.json'), 'utf-8')
    ) as any[];
    const trash = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'e2e-job-trash.json'), 'utf-8')
    ) as any[];
    const needs = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'e2e-needs-enrichment.json'), 'utf-8')
    ) as any[];

    const downstream = queue.length + trash.length + needs.length;
    const dataLossRisk = raw.length > 0 && downstream === 0;

    if (dataLossRisk) {
      return {
        name: 'E2E Data Flow',
        status: 'fail',
        message: `Potential data loss: ${raw.length} raw ingested but 0 downstream`,
        details: { rawCount: raw.length, downstreamCount: downstream },
      };
    }

    const successRate = raw.length > 0 ? ((downstream / raw.length) * 100).toFixed(1) : '0.0';
    return {
      name: 'E2E Data Flow',
      status: 'pass',
      message: `Data flow healthy: ${raw.length} raw → ${downstream} processed (${successRate}%)`,
      details: { rawCount: raw.length, downstreamCount: downstream, successRate },
    };
  } catch (error) {
    return {
      name: 'E2E Data Parsing',
      status: 'fail',
      message: `Failed to parse E2E output: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkStreamFailures(): Promise<ComplianceReport['checks'][0]> {
  const failureLogPath = path.join(process.cwd(), 'logs', 'stream-failures.jsonl');

  if (!fs.existsSync(failureLogPath)) {
    return {
      name: 'Stream Failures',
      status: 'pass',
      message: 'No stream failures recorded',
    };
  }

  const content = fs.readFileSync(failureLogPath, 'utf-8').trim();
  if (!content) {
    return {
      name: 'Stream Failures',
      status: 'pass',
      message: 'No stream failures recorded',
    };
  }

  const lines = content.split('\n');
  const recentFailures = lines
    .slice(-10)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const last24h = Date.now() - 24 * 60 * 60 * 1000;
  const recentCount = recentFailures.filter(
    (f: any) => new Date(f.timestamp).getTime() > last24h
  ).length;

  if (recentCount > 5) {
    return {
      name: 'Stream Failures',
      status: 'warn',
      message: `${recentCount} stream failures in last 24h`,
      details: { recentFailures: recentFailures.slice(0, 3) },
    };
  }

  return {
    name: 'Stream Failures',
    status: 'pass',
    message: `${recentCount} stream failures in last 24h (acceptable)`,
  };
}

async function checkDatabaseHealth(mongo: MongoClient): Promise<ComplianceReport['checks'][0]> {
  try {
    const db = mongo.db(config.mongodb.dbName);

    // Check collection stats
    const [rawCount, queueCount, trashCount, needsCount] = await Promise.all([
      db.collection('raw_ingest').countDocuments(),
      db.collection('job_queue').countDocuments(),
      db.collection('job_trash').countDocuments(),
      db.collection('needs_enrichment').countDocuments(),
    ]);

    const total = rawCount + queueCount + trashCount + needsCount;
    if (total === 0) {
      return {
        name: 'Database Health',
        status: 'warn',
        message: 'Database is empty - no jobs processed yet',
      };
    }

    // Check for stale jobs (needs enrichment for >48h)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const staleCount = await db.collection('needs_enrichment').countDocuments({
      status: 'pending',
      updatedAt: { $lt: twoDaysAgo },
    });

    if (staleCount > 10) {
      return {
        name: 'Database Health',
        status: 'warn',
        message: `${staleCount} stale enrichment jobs (>48h old)`,
        details: { staleCount },
      };
    }

    return {
      name: 'Database Health',
      status: 'pass',
      message: `Database healthy: ${total.toLocaleString()} total jobs`,
      details: { rawCount, queueCount, trashCount, needsCount },
    };
  } catch (error) {
    return {
      name: 'Database Health',
      status: 'fail',
      message: `Database check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkResourceUsage(): Promise<ComplianceReport['checks'][0]> {
  const mem = process.memoryUsage();
  const rssMb = Math.round(mem.rss / 1024 / 1024);
  const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);

  if (rssMb > 1800) {
    return {
      name: 'Resource Usage',
      status: 'fail',
      message: `Critical memory usage: ${rssMb}MB RSS`,
      details: { rssMb, heapUsedMb },
    };
  }

  if (rssMb > 1500) {
    return {
      name: 'Resource Usage',
      status: 'warn',
      message: `Elevated memory usage: ${rssMb}MB RSS`,
      details: { rssMb, heapUsedMb },
    };
  }

  return {
    name: 'Resource Usage',
    status: 'pass',
    message: `Memory usage normal: ${rssMb}MB RSS`,
    details: { rssMb, heapUsedMb },
  };
}

function generateRecommendations(checks: ComplianceReport['checks'][]): string[] {
  const recommendations: string[] = [];
  const flatChecks = checks.flat();

  const failedChecks = flatChecks.filter((c) => c.status === 'fail');
  const warnedChecks = flatChecks.filter((c) => c.status === 'warn');

  if (failedChecks.some((c) => c.name === 'E2E Data Flow')) {
    recommendations.push(
      '🔴 CRITICAL: Data loss detected. Review parsing/filtering logic immediately.'
    );
    recommendations.push('   → Run: npm run test:e2e to validate pipeline');
    recommendations.push('   → Check parse_log collection for errors');
  }

  if (warnedChecks.some((c) => c.name === 'Database Health' && c.message?.includes('stale'))) {
    recommendations.push('⚠️  Stale enrichment jobs detected. Consider:');
    recommendations.push('   → Running manual enrichment: npm run manual-enrichment');
    recommendations.push('   → Increasing automation coverage in job parser');
  }

  if (warnedChecks.some((c) => c.name === 'Stream Failures')) {
    recommendations.push('⚠️  Multiple stream failures. Check:');
    recommendations.push('   → Gmail API credentials and quotas');
    recommendations.push('   → Network connectivity');
    recommendations.push('   → logs/stream-failures.jsonl for patterns');
  }

  if (warnedChecks.some((c) => c.name === 'Resource Usage')) {
    recommendations.push('⚠️  Elevated memory usage. Consider:');
    recommendations.push('   → Reducing batch sizes (config.dataSource.batchSize)');
    recommendations.push('   → Implementing more aggressive garbage collection');
    recommendations.push('   → Reviewing memory leaks with heap snapshots');
  }

  if (recommendations.length === 0) {
    recommendations.push('✅ All systems healthy! No immediate action required.');
    recommendations.push('📊 Continue monitoring with: npm run dashboard -- --watch');
  }

  return recommendations;
}

async function runFeedbackLoop(): Promise<void> {
  logger.info('🔄 Starting daily feedback loop...');

  const mongo = new MongoClient(config.mongodb.uri);
  await mongo.connect();

  try {
    const checks = await Promise.all([
      checkE2EOutputCompliance(),
      checkStreamFailures(),
      checkDatabaseHealth(mongo),
      checkResourceUsage(),
    ]);

    const summary = {
      passed: checks.filter((c) => c.status === 'pass').length,
      warned: checks.filter((c) => c.status === 'warn').length,
      failed: checks.filter((c) => c.status === 'fail').length,
    };

    const recommendations = generateRecommendations([checks]);

    const report: ComplianceReport = {
      timestamp: new Date().toISOString(),
      checks,
      recommendations,
      summary,
    };

    // Print report to console
    console.log('\n╔════════════════════════════════════════════════════════════════════╗');
    console.log('║              📋 Daily Feedback Loop Report                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

    console.log(`📅 Report Time: ${new Date().toLocaleString()}\n`);

    console.log('📊 Summary');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`   ✅ Passed:  ${summary.passed}`);
    console.log(`   ⚠️  Warned:  ${summary.warned}`);
    console.log(`   ❌ Failed:  ${summary.failed}\n`);

    console.log('🔍 Checks');
    console.log('─────────────────────────────────────────────────────────────────────');
    checks.forEach((check) => {
      const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
      console.log(`   ${icon} ${check.name}: ${check.message}`);
      if (check.details) {
        console.log(
          `      Details: ${JSON.stringify(check.details, null, 2).split('\n').join('\n      ')}`
        );
      }
    });
    console.log();

    console.log('💡 Recommendations');
    console.log('─────────────────────────────────────────────────────────────────────');
    recommendations.forEach((rec) => console.log(`   ${rec}`));
    console.log();

    // Save report to file
    const reportsDir = path.join(process.cwd(), 'logs', 'feedback-reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const reportPath = path.join(
      reportsDir,
      `report-${new Date().toISOString().split('T')[0]}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`💾 Report saved to: ${reportPath}\n`);

    // Exit with appropriate code
    if (summary.failed > 0) {
      logger.error('❌ Feedback loop completed with failures');
      process.exit(1);
    } else if (summary.warned > 0) {
      logger.warn('⚠️  Feedback loop completed with warnings');
      process.exit(0);
    } else {
      logger.info('✅ Feedback loop completed successfully');
      process.exit(0);
    }
  } finally {
    await mongo.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runFeedbackLoop().catch((error) => {
    logger.error(`Feedback loop failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
