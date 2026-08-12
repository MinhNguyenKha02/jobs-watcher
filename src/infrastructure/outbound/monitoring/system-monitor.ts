export interface SystemSnapshot {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  cpuPercent: number;
  eventLoopLagMs: number;
}

export class SystemMonitor {
  private lastCpuUsage = process.cpuUsage();
  private lastCpuCheckMs = Date.now();
  private lagMs = 0;

  snapshot(): SystemSnapshot {
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;

    return {
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      heapTotalMb: mb(mem.heapTotal),
      externalMb: mb(mem.external),
      cpuPercent: this.snapshotCpuPercent(),
      eventLoopLagMs: this.lagMs,
    };
  }

  measureEventLoopLag(): void {
    const start = Date.now();
    setImmediate(() => {
      this.lagMs = Date.now() - start;
    });
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
}
