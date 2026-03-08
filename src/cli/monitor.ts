#!/usr/bin/env node

/**
 * Monitoring & Statistics CLI
 * 
 * View job statistics and activity logs:
 * - npm run stats        → Today's job stats
 * - npm run logs         → Last 1 day of actions
 * - npm run logs [days]  → Last N days of actions
 * - npm run monitor      → Full interactive dashboard
 * 
 * Shows: applied count, skipped, queued, average match score
 */

// getMonitoringStats import removed
import fs from 'fs';
import path from 'path';

function printStats() {
  console.log('\n📊 Jobs Watcher Monitoring\n');

  // getMonitoringStats removed

  // Performance metrics output removed
}

function printLogs(days = 7) {
  console.log(`\n📋 Recent Actions (last ${days} days)\n`);

  const logDir = path.join(process.cwd(), 'logs');
  
  if (!fs.existsSync(logDir)) {
    console.log('No logs found. Start processing jobs to generate logs.\n');
    return;
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const logFiles = fs.readdirSync(logDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  let count = 0;
  const maxShow = 20;

  for (const file of logFiles) {
    const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
    const lines = content.trim().split('\n').reverse();

    for (const line of lines) {
      if (count >= maxShow) break;

      try {
        const entry = JSON.parse(line);
        const date = new Date(entry.timestamp);

        if (date < cutoffDate) continue;

        const icon =
          entry.action === 'apply' ? '✓' :
          entry.action === 'skip' ? '✗' :
          '⏰';

        const score = entry.matchScore ? ` [${entry.matchScore}%]` : '';
        console.log(`${icon} ${date.toLocaleString()} | ${entry.company} - ${entry.position}${score}`);
        count++;
      } catch (e) {
        // Invalid JSON
      }
    }

    if (count >= maxShow) break;
  }

  console.log('');
}

function printUsage() {
  console.log(`
Jobs Watcher Monitoring

Usage:
  npx ts-node src/cli/monitor.ts [command]

Commands:
  stats             Show performance statistics
  logs [days]       Show recent actions (default: 7 days)
  help              Show this help message

Examples:
  npx ts-node src/cli/monitor.ts stats
  npx ts-node src/cli/monitor.ts logs 30
  `);
}

// Parse arguments
const command = process.argv[2];

if (command === 'stats') {
  printStats();
} else if (command === 'logs') {
  const days = parseInt(process.argv[3] || '7');
  printLogs(days);
} else if (command === 'help' || command === '--help' || command === '-h') {
  printUsage();
} else {
  // Default: show stats
  printStats();
}
