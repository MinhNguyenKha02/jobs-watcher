import { getLogger } from './logger.js';
import { notifyUser } from './notifications.js';
import type { Notification } from './notifications.js';

const logger = getLogger();

export interface MemoryMonitorConfig {
  warningThresholdMb: number;
  criticalThresholdMb: number;
  cpuWarningThresholdPercent?: number;
  cpuCriticalThresholdPercent?: number;
}

export interface MemorySnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  cpuPercent?: number;
}

export class MemoryMonitor {
  private config: MemoryMonitorConfig;
  private lastLevel: 'ok' | 'warning' | 'critical' = 'ok';
  private lastCpuLevel: 'ok' | 'warning' | 'critical' = 'ok';
  private lastCpuUsage = process.cpuUsage();
  private lastCpuCheckMs = Date.now();

  constructor(config: MemoryMonitorConfig = { warningThresholdMb: 160, criticalThresholdMb: 190 }) {
    this.config = config;
  }

  snapshot(): MemorySnapshot {
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

    return {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
      cpuPercent: this.snapshotCpuPercent(),
    };
  }

  private snapshotCpuPercent(): number {
    const now = Date.now();
    const elapsedMs = Math.max(now - this.lastCpuCheckMs, 1);
    const cpuUsage = process.cpuUsage();

    const userMicros = cpuUsage.user - this.lastCpuUsage.user;
    const systemMicros = cpuUsage.system - this.lastCpuUsage.system;
    const usedMicros = userMicros + systemMicros;

    this.lastCpuUsage = cpuUsage;
    this.lastCpuCheckMs = now;

    const cpuPercent = (usedMicros / (elapsedMs * 1000)) * 100;
    return Math.max(0, Math.round(cpuPercent * 100) / 100);
  }

  async checkAndAlert(context: string): Promise<void> {
    const snap = this.snapshot();
    const memoryLevel =
      snap.rssMb >= this.config.criticalThresholdMb
        ? 'critical'
        : snap.rssMb >= this.config.warningThresholdMb
          ? 'warning'
          : 'ok';
    const cpuWarning = this.config.cpuWarningThresholdPercent ?? 70;
    const cpuCritical = this.config.cpuCriticalThresholdPercent ?? 90;
    const cpuPercent = snap.cpuPercent ?? 0;
    const cpuLevel =
      cpuPercent >= cpuCritical ? 'critical' : cpuPercent >= cpuWarning ? 'warning' : 'ok';

    // Use a consistent notification ID for deduplication
    const notifyId = 2001;

    if (memoryLevel === 'ok') {
      this.lastLevel = 'ok';
    }
    if (cpuLevel === 'ok') {
      this.lastCpuLevel = 'ok';
    }

    if (memoryLevel !== 'ok' && this.lastLevel !== memoryLevel) {
      const title = memoryLevel === 'critical' ? '🚨 Memory Critical' : '⚠️ Memory Warning';
      const message = `${context}: RSS ${snap.rssMb}MB (heap ${snap.heapUsedMb}/${snap.heapTotalMb}MB)`;

      if (memoryLevel === 'critical') {
        logger.error(`[Memory] ${message}`);
      } else {
        logger.warn(`[Memory] ${message}`);
      }

      await notifyUser({
        title,
        message,
        urgency: memoryLevel === 'critical' ? 'high' : 'normal',
        id: notifyId,
      });

      this.lastLevel = memoryLevel;
    }

    if (cpuLevel !== 'ok' && this.lastCpuLevel !== cpuLevel) {
      const title = cpuLevel === 'critical' ? '🚨 CPU Critical' : '⚠️ CPU Warning';
      const message = `${context}: CPU ${cpuPercent}%`;

      if (cpuLevel === 'critical') {
        logger.error(`[CPU] ${message}`);
      } else {
        logger.warn(`[CPU] ${message}`);
      }

      await notifyUser({
        title,
        message,
        urgency: cpuLevel === 'critical' ? 'high' : 'normal',
        id: notifyId,
      });

      this.lastCpuLevel = cpuLevel;
    }
  }
}
