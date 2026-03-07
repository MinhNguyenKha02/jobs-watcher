#!/usr/bin/env bash

# Daily Feedback Loop Automation Script
# Run this via cron for continuous improvement monitoring
# 
# Crontab entry (daily at 2 AM):
# 0 2 * * * /home/minh-nguyen/node_projects/jobs-watcher/scripts/daily-feedback.sh

set -euo pipefail

# Configuration
PROJECT_DIR="/home/minh-nguyen/node_projects/jobs-watcher"
LOG_DIR="$PROJECT_DIR/logs"
REPORT_DIR="$LOG_DIR/feedback-reports"
DATE=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
SERVICE_PID_FILE="$LOG_DIR/data-listening.pid"
SUPERVISOR_PID_FILE="$LOG_DIR/infra-supervisor.pid"
RESTART_LOG_FILE="$LOG_DIR/infra-restarts.log"

if [ -f "$PROJECT_DIR/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "$PROJECT_DIR/.env"
    set +a
fi

P1_QUEUE_LAG_MAX_MS="${P1_QUEUE_LAG_MAX_MS:-300000}"
MAX_RESTARTS_DAILY="${MAX_RESTARTS_DAILY:-5}"
MAX_SWAP_USED_MB="${MAX_SWAP_USED_MB:-4608}"
MAX_SERVICE_PROCS="${MAX_SERVICE_PROCS:-1}"
MAX_DISK_PERCENT="${MAX_DISK_PERCENT:-90}"
MAX_CPU_PERCENT="${MAX_CPU_PERCENT:-95}"
INFRA_PROFILE="${INFRA_PROFILE:-i5_10th_16g_zram_swapfile}"

# Ensure directories exist
mkdir -p "$LOG_DIR"
mkdir -p "$REPORT_DIR"

# Log file for this run
LOG_FILE="$LOG_DIR/daily-feedback-$TIMESTAMP.log"

echo "═══════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "Daily Long-Living Loop - $TIMESTAMP" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

cd "$PROJECT_DIR"

# 1. Check if service is running
echo "🔍 Checking service status..." | tee -a "$LOG_FILE"
SERVICE_RUNNING=0
SERVICE_PID=""
if [ -f "$SERVICE_PID_FILE" ]; then
    SERVICE_PID=$(tr -d '[:space:]' < "$SERVICE_PID_FILE")
fi

if [ -n "$SERVICE_PID" ] && kill -0 "$SERVICE_PID" 2>/dev/null; then
    SERVICE_RUNNING=1
    echo "✅ Service is running (pid=$SERVICE_PID)" | tee -a "$LOG_FILE"
    UPTIME=$(ps -p "$SERVICE_PID" -o lstart= 2>/dev/null || true)
    if [ -n "${UPTIME:-}" ]; then
        echo "   Started: $UPTIME" | tee -a "$LOG_FILE"
    fi
else
    echo "⚠️  Service is not running (pid file missing or stale)" | tee -a "$LOG_FILE"
fi

SUPERVISOR_RUNNING=0
SUPERVISOR_PID=""
if [ -f "$SUPERVISOR_PID_FILE" ]; then
    SUPERVISOR_PID=$(tr -d '[:space:]' < "$SUPERVISOR_PID_FILE")
fi
if [ -n "$SUPERVISOR_PID" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    SUPERVISOR_RUNNING=1
    echo "✅ Infra supervisor is running (pid=$SUPERVISOR_PID)" | tee -a "$LOG_FILE"
else
    echo "⚠️  Infra supervisor is not running" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 2. Collect system metrics
echo "📊 Collecting system metrics..." | tee -a "$LOG_FILE"
MEMORY_MB=$(free -m | awk 'NR==2{printf "%d", $3}')
CPU_PERCENT=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
DISK_PERCENT=$(df -h "$PROJECT_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
SWAPPINESS_CURRENT=$(cat /proc/sys/vm/swappiness 2>/dev/null || echo "unknown")
echo "   Memory: ${MEMORY_MB}MB" | tee -a "$LOG_FILE"
echo "   CPU: ${CPU_PERCENT}%" | tee -a "$LOG_FILE"
echo "   Disk: ${DISK_PERCENT}%" | tee -a "$LOG_FILE"
echo "   Swappiness: ${SWAPPINESS_CURRENT}" | tee -a "$LOG_FILE"
echo "   Infra profile: ${INFRA_PROFILE}" | tee -a "$LOG_FILE"
echo "   Thresholds: swap<=${MAX_SWAP_USED_MB}MB cpu<=${MAX_CPU_PERCENT}% disk<=${MAX_DISK_PERCENT}% restarts<=${MAX_RESTARTS_DAILY}/day" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 3. Run long-living verification loop
echo "🔄 Running long-living closeout + hard gate..." | tee -a "$LOG_FILE"
FEEDBACK_EXIT_CODE=0
if ! npm run ll:daily:closeout >> "$LOG_FILE" 2>&1; then
    FEEDBACK_EXIT_CODE=1
fi
if ! P1_QUEUE_LAG_MAX_MS="$P1_QUEUE_LAG_MAX_MS" npm run ll:gate:hard >> "$LOG_FILE" 2>&1; then
    FEEDBACK_EXIT_CODE=1
fi

if [ $FEEDBACK_EXIT_CODE -eq 0 ]; then
    echo "✅ Feedback loop completed successfully" | tee -a "$LOG_FILE"
else
    echo "⚠️  Feedback loop completed with warnings (exit code: $FEEDBACK_EXIT_CODE)" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 4. Archive old logs (keep last 30 days)
echo "🗂️  Archiving old logs..." | tee -a "$LOG_FILE"
find "$LOG_DIR" -name "daily-feedback-*.log" -mtime +30 -delete
find "$REPORT_DIR" -name "report-*.json" -mtime +30 -delete
echo "   Cleaned logs older than 30 days" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# 5. Generate summary metrics
echo "📈 Generating daily metrics..." | tee -a "$LOG_FILE"
if [ -z "${MONGODB_URI:-}" ]; then
        echo "⚠️  Skipping DB metrics: MONGODB_URI is not set" | tee -a "$LOG_FILE"
elif ! node -e "
const fs = require('fs');
const { MongoClient } = require('mongodb');
(async () => {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('jobs_watcher');
  const metrics = {
    date: '$DATE',
    timestamp: new Date().toISOString(),
    rawCount: await db.collection('raw_ingest').countDocuments(),
    queuedCount: await db.collection('job_queue').countDocuments({ status: 'queued' }),
    trashedCount: await db.collection('job_trash').countDocuments(),
    enrichmentCount: await db.collection('needs_enrichment').countDocuments({ status: 'pending' }),
    systemMemoryMb: $MEMORY_MB,
    systemCpuPercent: $CPU_PERCENT,
  };
  fs.appendFileSync('$LOG_DIR/daily-metrics.jsonl', JSON.stringify(metrics) + '\n');
  console.log('   Raw Ingest:', metrics.rawCount);
  console.log('   Queued:', metrics.queuedCount);
  console.log('   Trashed:', metrics.trashedCount);
  console.log('   Needs Enrichment:', metrics.enrichmentCount);
  await mongo.close();
})();
" >> "$LOG_FILE" 2>&1; then
        echo "⚠️  Failed to collect DB metrics (see log details)" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"

# 6. Check for critical issues
echo "🚨 Checking for critical issues..." | tee -a "$LOG_FILE"

if [ "$SERVICE_RUNNING" -ne 1 ]; then
    echo "⚠️  ALERT: CASE_INFRA_SERVICE_DOWN" | tee -a "$LOG_FILE"
fi

if [ "$SUPERVISOR_RUNNING" -ne 1 ]; then
    echo "⚠️  ALERT: CASE_INFRA_SUPERVISOR_DOWN" | tee -a "$LOG_FILE"
fi

# Check if enrichment backlog is too large
ENRICHMENT_COUNT=0
if [ -n "${MONGODB_URI:-}" ]; then
        ENRICHMENT_COUNT=$(node -e "
const { MongoClient } = require('mongodb');
(async () => {
    const mongo = new MongoClient(process.env.MONGODB_URI);
    await mongo.connect();
    const db = mongo.db('jobs_watcher');
    const count = await db.collection('needs_enrichment').countDocuments({ status: 'pending' });
    console.log(count);
    await mongo.close();
})();
" 2>/dev/null || echo "0")
else
        echo "⚠️  Skipping enrichment backlog check: MONGODB_URI is not set" | tee -a "$LOG_FILE"
fi

if [ "$ENRICHMENT_COUNT" -gt 100 ]; then
    echo "⚠️  ALERT: Large enrichment backlog ($ENRICHMENT_COUNT jobs)" | tee -a "$LOG_FILE"
fi

# Check if service has crashed recently (bash-supervisor restart log)
RESTART_COUNT="0"
if [ -f "$RESTART_LOG_FILE" ]; then
    NOW_EPOCH=$(date +%s)
    SINCE_EPOCH=$((NOW_EPOCH - 86400))
    RESTART_COUNT=$(awk -v since="$SINCE_EPOCH" '$1 >= since {count++} END {print count+0}' "$RESTART_LOG_FILE")
fi
if [ "$RESTART_COUNT" -gt "$MAX_RESTARTS_DAILY" ]; then
    echo "⚠️  ALERT: CASE_INFRA_RESTART_SPIKE ($RESTART_COUNT restarts)" | tee -a "$LOG_FILE"
fi

# Check if more than one core pipeline process is running
SERVICE_PROC_COUNT=$(pgrep -f "data-listening.ts --adapter=hybrid" \
    | xargs -r ps -o pgid= -p \
    | awk '{print $1}' \
    | sort -u \
    | wc -l \
    | tr -d '[:space:]')
if [ "$SERVICE_PROC_COUNT" -gt "$MAX_SERVICE_PROCS" ]; then
    echo "⚠️  ALERT: CASE_INFRA_DUPLICATE_PROCS ($SERVICE_PROC_COUNT > $MAX_SERVICE_PROCS)" | tee -a "$LOG_FILE"
fi

# Check swap pressure (laptop stability guardrail)
SWAP_USED_MB=$(free -m | awk 'NR==3{print $3}')
if [ "$SWAP_USED_MB" -gt "$MAX_SWAP_USED_MB" ]; then
        echo "⚠️  ALERT: CASE_INFRA_SWAP_PRESSURE (${SWAP_USED_MB}MB > ${MAX_SWAP_USED_MB}MB)" | tee -a "$LOG_FILE"
fi

if [ "$DISK_PERCENT" -gt "$MAX_DISK_PERCENT" ]; then
        echo "⚠️  ALERT: CASE_INFRA_DISK_PRESSURE (${DISK_PERCENT}% > ${MAX_DISK_PERCENT}%)" | tee -a "$LOG_FILE"
fi

if [ "$(printf '%.0f' "$CPU_PERCENT")" -gt "$MAX_CPU_PERCENT" ]; then
    echo "ℹ️  NOTE: CPU pressure observed (${CPU_PERCENT}% > ${MAX_CPU_PERCENT}%) [monitor-only, non-gating]" | tee -a "$LOG_FILE"
fi

echo "📦 Generating structured daily CASE artifact..." | tee -a "$LOG_FILE"
CASES_FILE="$REPORT_DIR/daily-cases-$TIMESTAMP.json"
LATEST_CASES_FILE="$REPORT_DIR/daily-cases-latest.json"

if ! PROJECT_DIR="$PROJECT_DIR" \
    CASES_FILE="$CASES_FILE" \
    P1_QUEUE_LAG_MAX_MS="$P1_QUEUE_LAG_MAX_MS" \
    MAX_RESTARTS_DAILY="$MAX_RESTARTS_DAILY" \
    MAX_SWAP_USED_MB="$MAX_SWAP_USED_MB" \
    MAX_SERVICE_PROCS="$MAX_SERVICE_PROCS" \
    MAX_DISK_PERCENT="$MAX_DISK_PERCENT" \
    SERVICE_RUNNING="$SERVICE_RUNNING" \
    SUPERVISOR_RUNNING="$SUPERVISOR_RUNNING" \
    RESTART_COUNT="$RESTART_COUNT" \
    SWAP_USED_MB="$SWAP_USED_MB" \
    DISK_PERCENT="$DISK_PERCENT" \
    SERVICE_PROC_COUNT="$SERVICE_PROC_COUNT" \
    node -e "
const fs = require('fs');
const path = require('path');

const outputDir = path.join(process.env.PROJECT_DIR, 'src', 'db', 'e2e-output');
const cases = [];
const now = new Date().toISOString();

const pushCase = (name, severity, details) => {
    cases.push({ case: name, severity, details, detectedAt: now });
};

const readJsonSafe = (file) => {
    const target = path.join(outputDir, file);
    if (!fs.existsSync(target)) return null;
    try {
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    } catch {
        return null;
    }
};

const metrics = readJsonSafe('e2e-metrics.json');
const actionLog = readJsonSafe('e2e-action-log.json');

if (Array.isArray(metrics)) {
    const queueLag = metrics
        .filter((x) => ['queue_lag_ms', 'queuelagms'].includes(String((x.metric || x.name || '')).toLowerCase()))
        .map((x) => Number(x.value))
        .filter((x) => Number.isFinite(x));
    const threshold = Number(process.env.P1_QUEUE_LAG_MAX_MS || '300000');
    if (queueLag.length === 0) pushCase('CASE_P1_QUEUE_LAG', 'warning', { reason: 'missing_metric' });
    else if (Math.max(...queueLag) > threshold) {
        pushCase('CASE_P1_QUEUE_LAG', 'critical', { max: Math.max(...queueLag), threshold });
    }

    const hasConcurrency = metrics.some((x) => ['concurrency_inflight', 'concurrencyinflight'].includes(String((x.metric || x.name || '')).toLowerCase()));
    if (!hasConcurrency) pushCase('CASE_P2_CONCURRENCY_MISSING', 'warning', { reason: 'missing_metric' });

    const hasBackpressure = metrics.some((x) => ['backpressure_queue_depth', 'backpressurequeuedepth'].includes(String((x.metric || x.name || '')).toLowerCase()));
    if (!hasBackpressure) pushCase('CASE_P2_BACKPRESSURE_MISSING', 'warning', { reason: 'missing_metric' });

    const memory = metrics
        .filter((x) => ['memory_rss_mb', 'memoryrssmb'].includes(String((x.metric || x.name || '')).toLowerCase()))
        .map((x) => Number(x.value))
        .filter((x) => Number.isFinite(x));
    if (memory.length >= 2 && memory[memory.length - 1] > memory[0]) {
        pushCase('CASE_P2_MEMORY_TREND', 'warning', { first: memory[0], last: memory[memory.length - 1] });
    }
}

if (Array.isArray(actionLog)) {
    const hasAlert = actionLog.some((x) => {
        const action = String(x.action || '');
        if (/^alert_routed_(desktop|webhook|email)$/.test(action)) return true;
        const channel = String((x.details && (x.details.channel || x.details.alertChannel)) || '');
        return ['desktop', 'webhook', 'email'].includes(channel);
    });
    if (!hasAlert) pushCase('CASE_P1_ALERT_ROUTE_MISSING', 'warning', { reason: 'missing_alert_route' });
}

if (process.env.SERVICE_RUNNING !== '1') pushCase('CASE_INFRA_SERVICE_DOWN', 'critical', {});
if (process.env.SUPERVISOR_RUNNING !== '1') pushCase('CASE_INFRA_SUPERVISOR_DOWN', 'critical', {});

const restartCount = Number(process.env.RESTART_COUNT || '0');
const maxRestarts = Number(process.env.MAX_RESTARTS_DAILY || '5');
if (Number.isFinite(restartCount) && restartCount > maxRestarts) {
    pushCase('CASE_INFRA_RESTART_SPIKE', 'critical', { restartCount, maxRestarts });
}

const swapUsed = Number(process.env.SWAP_USED_MB || '0');
const maxSwap = Number(process.env.MAX_SWAP_USED_MB || '3072');
if (Number.isFinite(swapUsed) && swapUsed > maxSwap) {
    pushCase('CASE_INFRA_SWAP_PRESSURE', 'warning', { swapUsed, maxSwap });
}

const diskPercent = Number(process.env.DISK_PERCENT || '0');
const maxDisk = Number(process.env.MAX_DISK_PERCENT || '90');
if (Number.isFinite(diskPercent) && diskPercent > maxDisk) {
    pushCase('CASE_INFRA_DISK_PRESSURE', 'warning', { diskPercent, maxDisk });
}

const serviceProcs = Number(process.env.SERVICE_PROC_COUNT || '0');
const maxProcs = Number(process.env.MAX_SERVICE_PROCS || '1');
if (Number.isFinite(serviceProcs) && serviceProcs > maxProcs) {
    pushCase('CASE_INFRA_DUPLICATE_PROCS', 'critical', { serviceProcs, maxProcs });
}

const result = {
    generatedAt: now,
    verdict: cases.some((c) => c.severity === 'critical') ? 'NO-GO' : cases.length > 0 ? 'HOLD' : 'GO',
    cases,
};

fs.writeFileSync(process.env.CASES_FILE, JSON.stringify(result, null, 2));
console.log('   CASE artifact:', process.env.CASES_FILE, 'cases=', cases.length, 'verdict=', result.verdict);
" >> "$LOG_FILE" 2>&1; then
        echo "⚠️  Failed to generate structured CASE artifact" | tee -a "$LOG_FILE"
else
        cp "$CASES_FILE" "$LATEST_CASES_FILE"
fi

echo "" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG_FILE"
echo "Daily long-living loop completed at $(date)" | tee -a "$LOG_FILE"
echo "═══════════════════════════════════════════════════════" | tee -a "$LOG_FILE"

# Send desktop notification with verdict + cases (optional, requires notify-send)
if command -v notify-send &> /dev/null; then
    VERDICT="unknown"
    CASE_COUNT="unknown"
    if [ -f "$LATEST_CASES_FILE" ]; then
        VERDICT="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(d.verdict||'unknown')" "$LATEST_CASES_FILE" 2>/dev/null || echo "unknown")"
        CASE_COUNT="$(node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(d.cases)?d.cases.length:0)" "$LATEST_CASES_FILE" 2>/dev/null || echo "unknown")"
    fi

    HEALTH_TAG="service:${SERVICE_RUNNING} supervisor:${SUPERVISOR_RUNNING}"
    if [ "$VERDICT" = "GO" ]; then
        notify-send "Jobs Watcher Daily" "verdict=${VERDICT} cases=${CASE_COUNT} ${HEALTH_TAG}"
    elif [ "$VERDICT" = "HOLD" ]; then
        notify-send -u normal "Jobs Watcher Daily" "verdict=${VERDICT} cases=${CASE_COUNT} ${HEALTH_TAG}"
    else
        notify-send -u critical "Jobs Watcher Daily" "verdict=${VERDICT} cases=${CASE_COUNT} ${HEALTH_TAG}"
    fi
fi

exit 0
