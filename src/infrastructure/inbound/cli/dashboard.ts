#!/usr/bin/env tsx

/**
 * Real-time Monitoring Dashboard for Jobs Watcher
 * Shows system metrics, job statistics, and resource usage
 */

import fs from 'fs';
import path from 'path';

import { MongoClient } from 'mongodb';

import { config } from '../../../config.js';
import { getLogger } from '../../outbound/logging/logger.js';
import { MemoryMonitor } from '../../outbound/monitoring/memory-monitor.js';

const logger = getLogger();

interface DashboardMetrics {
  system: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    cpuPercent: number;
    uptime: number;
  };
  jobs: {
    rawIngestCount: number;
    queuedCount: number;
    needsEnrichmentCount: number;
    trashedCount: number;
    processingRate: number; // jobs per hour
  };
  health: {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
  };
}

async function getSystemMetrics(memoryMonitor: MemoryMonitor) {
  const snap = memoryMonitor.snapshot();
  return {
    rssMb: snap.rssMb,
    heapUsedMb: snap.heapUsedMb,
    heapTotalMb: snap.heapTotalMb,
    cpuPercent: snap.cpuPercent || 0,
    uptime: Math.floor(process.uptime()),
  };
}

async function getJobMetrics(mongo: MongoClient): Promise<DashboardMetrics['jobs']> {
  const db = mongo.db(config.mongodb.dbName);

  const [rawIngestCount, queuedCount, needsEnrichmentCount, trashedCount] = await Promise.all([
    db.collection('raw_ingest').countDocuments(),
    db.collection('job_queue').countDocuments({ status: 'queued' }),
    db
      .collection('needs_enrichment')
      .countDocuments({ status: { $in: ['pending', 'retry_requested'] } }),
    db.collection('job_trash').countDocuments(),
  ]);

  // Calculate processing rate (jobs per hour in last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentJobs = await db
    .collection('raw_ingest')
    .countDocuments({ ingestedAt: { $gte: oneDayAgo } });
  const processingRate = Math.round(recentJobs / 24);

  return {
    rawIngestCount,
    queuedCount,
    needsEnrichmentCount,
    trashedCount,
    processingRate,
  };
}

function assessHealth(
  system: DashboardMetrics['system'],
  jobs: DashboardMetrics['jobs']
): DashboardMetrics['health'] {
  const issues: string[] = [];
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';

  // Memory checks
  if (system.rssMb > 1800) {
    issues.push(`High memory usage: ${system.rssMb}MB`);
    status = 'critical';
  } else if (system.rssMb > 1500) {
    issues.push(`Elevated memory usage: ${system.rssMb}MB`);
    if (status === 'healthy') status = 'warning';
  }

  // CPU checks
  if (system.cpuPercent > 90) {
    issues.push(`Critical CPU usage: ${system.cpuPercent}%`);
    status = 'critical';
  } else if (system.cpuPercent > 70) {
    issues.push(`High CPU usage: ${system.cpuPercent}%`);
    if (status === 'healthy') status = 'warning';
  }

  // Queue backlog checks
  if (jobs.needsEnrichmentCount > 100) {
    issues.push(`Large enrichment backlog: ${jobs.needsEnrichmentCount} jobs`);
    if (status === 'healthy') status = 'warning';
  }

  // Processing rate checks
  if (jobs.processingRate === 0 && jobs.rawIngestCount > 0) {
    issues.push('No jobs processed in last 24h');
    if (status === 'healthy') status = 'warning';
  }

  return { status, issues };
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function printDashboard() {
  const memoryMonitor = new MemoryMonitor({
    warningThresholdMb: 1500,
    criticalThresholdMb: 1800,
    cpuWarningThresholdPercent: 70,
    cpuCriticalThresholdPercent: 90,
  });

  const mongo = new MongoClient(config.mongodb.uri);
  await mongo.connect();

  try {
    const system = await getSystemMetrics(memoryMonitor);
    const jobs = await getJobMetrics(mongo);
    const health = assessHealth(system, jobs);

    console.clear();
    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║         📊 Jobs Watcher - Real-time Monitoring Dashboard         ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

    // Health Status
    const statusIcon =
      health.status === 'healthy' ? '✅' : health.status === 'warning' ? '⚠️' : '🚨';
    const statusColor =
      health.status === 'healthy'
        ? '\x1b[32m'
        : health.status === 'warning'
          ? '\x1b[33m'
          : '\x1b[31m';
    console.log(`${statusIcon} Health Status: ${statusColor}${health.status.toUpperCase()}\x1b[0m`);
    if (health.issues.length > 0) {
      health.issues.forEach((issue) => console.log(`   • ${issue}`));
    }
    console.log();

    // System Metrics
    console.log('📈 System Metrics');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`   Memory (RSS):     ${system.rssMb.toFixed(1)} MB`);
    console.log(
      `   Heap Used:        ${system.heapUsedMb.toFixed(1)} / ${system.heapTotalMb.toFixed(1)} MB`
    );
    console.log(`   CPU Usage:        ${system.cpuPercent.toFixed(1)}%`);
    console.log(`   Uptime:           ${formatUptime(system.uptime)}`);
    console.log();

    // Job Statistics
    console.log('📋 Job Statistics');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`   Raw Ingested:     ${jobs.rawIngestCount.toLocaleString()}`);
    console.log(`   Queued:           ${jobs.queuedCount.toLocaleString()}`);
    console.log(`   Needs Enrichment: ${jobs.needsEnrichmentCount.toLocaleString()}`);
    console.log(`   Trashed:          ${jobs.trashedCount.toLocaleString()}`);
    console.log(`   Processing Rate:  ${jobs.processingRate} jobs/hour`);
    console.log();

    // Performance Ratio
    const totalProcessed = jobs.queuedCount + jobs.trashedCount + jobs.needsEnrichmentCount;
    if (totalProcessed > 0) {
      const queueRate = ((jobs.queuedCount / totalProcessed) * 100).toFixed(1);
      const trashRate = ((jobs.trashedCount / totalProcessed) * 100).toFixed(1);
      const enrichRate = ((jobs.needsEnrichmentCount / totalProcessed) * 100).toFixed(1);

      console.log('📊 Processing Distribution');
      console.log('─────────────────────────────────────────────────────────────────────');
      console.log(`   ✓ Queued:         ${queueRate}%`);
      console.log(`   ✗ Trashed:        ${trashRate}%`);
      console.log(`   ⏰ Enrichment:     ${enrichRate}%`);
      console.log();
    }

    // Footer
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log(`Last updated: ${new Date().toLocaleString()}`);
    console.log('Press Ctrl+C to exit | Refreshes every 30 seconds');
    console.log();
  } finally {
    await mongo.close();
  }
}

async function runDashboard(watchMode = false) {
  if (!watchMode) {
    await printDashboard();
    return;
  }

  // Watch mode - refresh every 30 seconds
  console.log('🔄 Starting dashboard in watch mode...\n');

  const refresh = async () => {
    try {
      await printDashboard();
    } catch (error) {
      logger.error(
        `Dashboard refresh failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  await refresh();
  const interval = setInterval(refresh, 30000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n👋 Shutting down dashboard...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    clearInterval(interval);
    process.exit(0);
  });
}

// CLI interface
const command = process.argv[2];
const watchMode =
  process.argv.includes('--watch') || process.argv.includes('-w') || command === 'watch';

if (import.meta.url === `file://${process.argv[1]}`) {
  runDashboard(watchMode).catch((error) => {
    logger.error(`Dashboard failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
