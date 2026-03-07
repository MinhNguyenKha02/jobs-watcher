import fs from 'fs';
import path from 'path';

export type GateRecord = Record<string, unknown>;

export type HardGateFailure = {
  gate: 'P0' | 'P1' | 'P2';
  reason: string;
};

export type HardGateInput = {
  actionLog: GateRecord[];
  needsEnrichment: GateRecord[];
  jobQueue: GateRecord[];
  jobTrash: GateRecord[];
  metrics: GateRecord[];
};

function getString(record: GateRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(record: GateRecord, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getMetricValue(entry: GateRecord): number | undefined {
  const numericFields = [
    'value',
    'queueLagMs',
    'memoryRssMb',
    'concurrencyInflight',
    'backpressureQueueDepth',
  ];
  for (const field of numericFields) {
    const numberValue = getNumber(entry, field);
    if (typeof numberValue === 'number') return numberValue;
  }
  return undefined;
}

function matchesMetric(entry: GateRecord, names: string[]): boolean {
  const metric = getString(entry, 'metric');
  const name = getString(entry, 'name');
  return (
    names.includes(String(metric || '').toLowerCase()) ||
    names.includes(String(name || '').toLowerCase())
  );
}

function getDetails(record: GateRecord): GateRecord {
  const details = record.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return details as GateRecord;
}

function getTimestampMs(record: GateRecord): number | undefined {
  const timestamp = getString(record, 'timestamp');
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return undefined;
  return parsed;
}

export function validateP0HardGate(input: HardGateInput): HardGateFailure[] {
  const failures: HardGateFailure[] = [];
  const terminalActions = new Set(['manual_validate_to_queue', 'manual_reject_to_trash']);

  const routeActions = input.actionLog.filter((log) => {
    const action = getString(log, 'action');
    return typeof action === 'string' && terminalActions.has(action);
  });

  if (routeActions.length === 0) {
    failures.push({
      gate: 'P0',
      reason:
        'Missing runtime TUI action evidence: expected at least one manual_validate_to_queue or manual_reject_to_trash in e2e-action-log.json',
    });
  }

  if (process.env.VERIFY_OPERATOR_FRESHNESS === '1') {
    const maxAgeHours = Number.parseInt(process.env.OPERATOR_EVIDENCE_MAX_AGE_HOURS || '24', 10);
    const nowMs = Date.now();
    const latestActionMs = routeActions
      .map((log) => getTimestampMs(log))
      .filter((value): value is number => typeof value === 'number')
      .reduce((max, value) => Math.max(max, value), 0);

    if (latestActionMs === 0) {
      failures.push({
        gate: 'P0',
        reason:
          'Missing timestamp on operator route evidence: expected ISO timestamp on manual_validate_to_queue/manual_reject_to_trash action_log entries',
      });
    } else {
      const ageHours = (nowMs - latestActionMs) / (60 * 60 * 1000);
      if (ageHours > maxAgeHours) {
        failures.push({
          gate: 'P0',
          reason: `Operator route evidence is stale: latest action age=${ageHours.toFixed(2)}h > ${maxAgeHours}h`,
        });
      }
    }
  }

  const finalizedNeeds = input.needsEnrichment.filter((record) => {
    const route = getString(record, 'finalRoute');
    return route === 'job_queue' || route === 'job_trash';
  });

  if (finalizedNeeds.length === 0) {
    failures.push({
      gate: 'P0',
      reason:
        'Missing needs_enrichment finalRoute evidence: expected at least one record with finalRoute=job_queue or finalRoute=job_trash',
    });
  }

  finalizedNeeds.forEach((record) => {
    const messageId = getString(record, 'messageId');
    const route = getString(record, 'finalRoute');
    if (!messageId || !route) {
      failures.push({
        gate: 'P0',
        reason: 'Found finalized needs_enrichment record missing messageId or finalRoute',
      });
      return;
    }

    if (route === 'job_queue') {
      const queueMatch = input.jobQueue.some(
        (queued) => getString(queued, 'messageId') === messageId
      );
      if (!queueMatch) {
        failures.push({
          gate: 'P0',
          reason: `Route mismatch for ${messageId}: finalRoute=job_queue but no matching record in e2e-job-queue.json`,
        });
      }
    }

    if (route === 'job_trash') {
      const trashMatch = input.jobTrash.some((trashed) => {
        const rootMessageId = getString(trashed, 'messageId');
        const original = trashed.original;
        const originalMessageId =
          original && typeof original === 'object' && !Array.isArray(original)
            ? getString(original as GateRecord, 'messageId')
            : undefined;
        return rootMessageId === messageId || originalMessageId === messageId;
      });

      if (!trashMatch) {
        failures.push({
          gate: 'P0',
          reason: `Route mismatch for ${messageId}: finalRoute=job_trash but no matching record in e2e-job-trash.json`,
        });
      }
    }

    const expectedAction =
      route === 'job_queue' ? 'manual_validate_to_queue' : 'manual_reject_to_trash';
    const actionMatch = input.actionLog.some((log) => {
      const action = getString(log, 'action');
      const actionMessageId = getString(log, 'messageId');
      const details = getDetails(log);
      const detailsRoute = getString(details, 'route');
      return action === expectedAction && actionMessageId === messageId && detailsRoute === route;
    });

    if (!actionMatch) {
      failures.push({
        gate: 'P0',
        reason: `Missing correlated action_log event for ${messageId}: expected action=${expectedAction} with details.route=${route}`,
      });
    }
  });

  return failures;
}

export function validateP1P2HardGate(input: HardGateInput): HardGateFailure[] {
  const failures: HardGateFailure[] = [];

  const hasAlertRoutingEvidence = input.actionLog.some((log) => {
    const action = getString(log, 'action') || '';
    if (/^alert_routed_(desktop|webhook|email)$/.test(action)) return true;
    const details = getDetails(log);
    const channel = getString(details, 'channel') || getString(details, 'alertChannel') || '';
    return ['desktop', 'webhook', 'email'].includes(channel);
  });

  if (!hasAlertRoutingEvidence) {
    failures.push({
      gate: 'P1',
      reason: 'Missing P1 alert-routing evidence in action_log (desktop/webhook/email)',
    });
  }

  const queueLagMetrics = input.metrics
    .filter((entry) => matchesMetric(entry, ['queue_lag_ms', 'queuelagms']))
    .map((entry) => getMetricValue(entry))
    .filter((value): value is number => typeof value === 'number');

  const queueLagThresholdMs = Number.parseInt(process.env.P1_QUEUE_LAG_MAX_MS || '300000', 10);
  if (queueLagMetrics.length === 0) {
    failures.push({
      gate: 'P1',
      reason: 'Missing P1 queue-lag metric evidence in e2e-metrics.json',
    });
  } else if (Math.max(...queueLagMetrics) > queueLagThresholdMs) {
    failures.push({
      gate: 'P1',
      reason: `P1 queue-lag threshold exceeded: max=${Math.max(...queueLagMetrics)}ms > ${queueLagThresholdMs}ms`,
    });
  }

  const hasRunbook = fs.existsSync(path.join(process.cwd(), 'docs', 'LONG_LIVING_EVALUATION.md'));
  if (!hasRunbook) {
    failures.push({
      gate: 'P1',
      reason: 'Missing restart/incident runbook: docs/LONG_LIVING_EVALUATION.md',
    });
  }

  const concurrencyValues = input.metrics
    .filter((entry) => matchesMetric(entry, ['concurrency_inflight', 'concurrencyinflight']))
    .map((entry) => getMetricValue(entry))
    .filter((value): value is number => typeof value === 'number');

  if (concurrencyValues.length === 0) {
    failures.push({
      gate: 'P2',
      reason: 'Missing P2 bounded-concurrency metric evidence in e2e-metrics.json',
    });
  }

  const backpressureValues = input.metrics
    .filter((entry) => matchesMetric(entry, ['backpressure_queue_depth', 'backpressurequeuedepth']))
    .map((entry) => getMetricValue(entry))
    .filter((value): value is number => typeof value === 'number');

  if (backpressureValues.length === 0) {
    failures.push({
      gate: 'P2',
      reason: 'Missing P2 backpressure metric evidence in e2e-metrics.json',
    });
  }

  const memoryValues = input.metrics
    .filter((entry) => matchesMetric(entry, ['memory_rss_mb', 'memoryrssmb']))
    .map((entry) => getMetricValue(entry))
    .filter((value): value is number => typeof value === 'number');

  if (memoryValues.length < 2) {
    failures.push({
      gate: 'P2',
      reason: 'Missing memory trend evidence: expected at least 2 memory_rss_mb points',
    });
  } else {
    const first = memoryValues[0];
    const last = memoryValues[memoryValues.length - 1];
    if (last > first) {
      failures.push({
        gate: 'P2',
        reason: `Memory trend not improving: first=${first}MB last=${last}MB`,
      });
    }
  }

  return failures;
}
