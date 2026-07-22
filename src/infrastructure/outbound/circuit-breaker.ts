import { getLogger } from './logging/logger.js';

const logger = getLogger();

export class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private isOpen = false;
  private lastFailureTime = 0;

  constructor(
    readonly failureThreshold = 5,
    readonly successThreshold = 3,
    readonly resetTimeMs = 60000,
  ) {}

  async execute<T>(fn: () => Promise<T>, operationName: string): Promise<T | null> {
    if (this.isOpen && Date.now() - this.lastFailureTime > this.resetTimeMs) {
      logger.info(`Circuit breaker reset for ${operationName}`);
      this.isOpen = false;
      this.failureCount = 0;
      this.successCount = 0;
    }

    if (this.isOpen) {
      logger.warn(`Circuit breaker open for ${operationName} — returning null`);
      return null;
    }

    try {
      const result = await fn();
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.failureCount = 0;
        this.successCount = 0;
      }
      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();
      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        logger.error(`Circuit breaker OPEN for ${operationName} — too many failures`);
      }
      throw err;
    }
  }

  getState() {
    return {
      isOpen: this.isOpen,
      consecutiveFailures: this.failureCount,
      openUntil: this.isOpen ? new Date(this.lastFailureTime + this.resetTimeMs).toISOString() : null,
    };
  }
}
