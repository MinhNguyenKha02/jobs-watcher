/**
 * SSE Job Reader
 *
 * Subscribes to the server's SSE /events endpoint and buffers job events.
 * Provides a non-blocking `nextJob()` method that returns the next job in FIFO order.
 * Handles reconnection and parse-stage + routing events.
 */

import { getLogger } from '../../../infrastructure/outbound/logging/logger.js';
import startSseClient from '../sse-client.js';

const logger = getLogger();

import type { Job as CoreJob } from '../../../domain/types/job.js';
export type Job = CoreJob;

const PROCESSED_IDS_MAX_SIZE = 1000;

export class SseJobReader {
  private baseUrl: string;
  private token: string | undefined;
  private jobQueue: Job[] = [];
  private processedJobLifecycleIds = new Set<string>();
  private sseHandle: ReturnType<typeof startSseClient> | null = null;
  private connected = false;
  private jobArrivalSignal: (() => void) | null = null;
  private eventListeners: Map<string, Set<(event: any) => void>> = new Map();

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  /**
   * Add an event listener for SSE events (job.routed, job.generated, etc.)
   */
  addEventListener(eventType: string, callback: (event: any) => void): void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(callback);
    logger.debug(`[sse-listener] Registered listener for ${eventType}`);
  }

  /**
   * Remove an event listener
   */
  removeEventListener(eventType: string, callback: (event: any) => void): void {
    if (this.eventListeners.has(eventType)) {
      this.eventListeners.get(eventType)!.delete(callback);
    }
  }

  /**
   * Emit event to all registered listeners
   */
  private emitEvent(eventType: string, data: any): void {
    logger.debug('[SSE-READER] 🔔 emitEvent called', { eventType, hasListeners: this.eventListeners.has(eventType) });
    if (this.eventListeners.has(eventType)) {
      const listeners = this.eventListeners.get(eventType);
      logger.debug('[SSE-READER] 🔔 Listeners count', { eventType, count: listeners?.size });
      for (const callback of listeners!) {
        try {
          logger.debug('[SSE-READER] 🔔 Invoking callback for', { eventType });
          callback({ type: eventType, data });
          logger.debug('[SSE-READER] 🔔 Callback completed for', { eventType });
        } catch (err) {
          logger.warn(`[sse-listener] Error in listener for ${eventType}`, { error: String(err) });
        }
      }
    } else {
      logger.warn('[SSE-READER] ⚠️ No listeners for event', { eventType });
    }
  }

  /**
   * Start the SSE subscription.
   */
  connect(): Promise<void> {
    return new Promise((resolve) => {
      logger.info('[SSE-READER] 🔌 Connecting to SSE endpoint...', {
        baseUrl: this.baseUrl,
        hasToken: !!this.token,
        tokenLength: this.token?.length || 0,
      });
      
      this.sseHandle = startSseClient(this.baseUrl, this.token, {
        onOpen: () => {
          this.connected = true;
          logger.info('[SSE-READER] 🟢 ✅ SSE connection established', {
            baseUrl: this.baseUrl,
            timestamp: new Date().toISOString(),
          });
          resolve();
        },
        onMessage: (ev: any) => {
          logger.debug('[SSE-READER] 📦 Received message from SSE', {
            type: ev.type,
            hasPayload: !!ev.payload,
          });
          logger.debug('[SSE-READER] 🔰 About to call handleSseEvent');
          try {
            this.handleSseEvent(ev);
            logger.debug('[SSE-READER] 🔰 handleSseEvent completed normally');
          } catch (err) {
            logger.error('[SSE-READER] ❌ Error in handleSseEvent', {
              error: String(err),
              eventType: ev.type,
              stack: (err as any)?.stack?.split('\n')[0],
            });
          }
        },
        onError: (err: any) => {
          this.connected = false;
          logger.warn('[SSE-READER] ⚠️  SSE error, will reconnect', {
            error: err instanceof Error ? (err.message + (err.stack ? ' | ' + err.stack.split('\n')[0] : '')) : JSON.stringify(err),
            baseUrl: this.baseUrl,
          });
        },
      });
    });
  }

  /**
   * Close the SSE connection.
   */
  disconnect(): void {
    try {
      this.sseHandle?.close();
      this.connected = false;
      logger.info('SSE disconnected');
    } catch (err) {
      logger.warn('Error disconnecting SSE', { error: String(err) });
    }
  }

  /**
   * Get the next job from the queue (FIFO).
   * Blocks until a job is available or timeout occurs.
   */
  async nextJob(): Promise<Job | null> {
    // Skip processed jobs (routed/failed), return next unprocessed
    while (this.jobQueue.length > 0) {
      const job = this.jobQueue[0];
      const jobId = job._id;
      if (jobId && this.processedJobLifecycleIds.has(jobId)) {
        this.jobQueue.shift();
        continue;
      }
      return this.jobQueue.shift() || null;
    }

    // Wait for next job via signal
    return new Promise((resolve) => {
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          this.jobArrivalSignal = null;
          resolve(null);
        }
      }, 300000);

      this.jobArrivalSignal = () => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          this.jobArrivalSignal = null;
          // Same skip logic: drain processed jobs before returning
          while (this.jobQueue.length > 0) {
            const job = this.jobQueue[0];
            const jobId = job._id;
            if (jobId && this.processedJobLifecycleIds.has(jobId)) {
              this.jobQueue.shift();
              continue;
            }
            break;
          }
          resolve(this.jobQueue.shift() || null);
        }
      };
    });
  }

  /**
   * Check if the SSE connection is currently active.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Internal: handle incoming SSE events and maintain job queue.
   */
  private handleSseEvent(ev: any): void {
    const { type, payload } = ev;
    logger.debug('[SSE-READER] Processing event in handleSseEvent', {
      eventType: type,
      hasPayload: !!payload,
      jobLifecycleId: payload?.jobLifecycleId,
    });

    // Track job lifecycle events
    logger.debug('[SSE-READER] 📍 Checking job.generated branch', { eventType: type });
    if (type === 'job.generated') {
      logger.info('[SSE-READER] 📥 Processing job.generated event', {
        jobLifecycleId: payload?.jobLifecycleId,
        company: payload?.company,
        role: payload?.role
      });
      
      const job: Job = {
        _id: payload.jobLifecycleId || `sse-fallback-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        company: payload.company || 'Unknown Company',
        role: payload.role || 'Unknown Role',
        location: payload.location,
        url: payload.url,
        matchScore: payload.matchScore || payload.score || 0,
        matchedSkills: payload.matchedProfileSkills || [],
        ...payload,
      };

      // Avoid duplicates: only prevent immediate re-add, don't mark as done
      if (!this.processedJobLifecycleIds.has(job._id!)) {
        this.jobQueue.push(job);
        logger.info('[SSE-READER] 📥 Job buffered to queue', {
          jobLifecycleId: job._id,
          company: job.company,
          queueDepth: this.jobQueue.length,
        });

        this.emitEvent('job.generated', payload);

        // Wake up any waiting nextJob() call
        if (this.jobArrivalSignal) {
          logger.info('[SSE-READER] 🔔 Signaling waiting nextJob() call');
          this.jobArrivalSignal();
        }
      } else {
        logger.debug('[SSE-READER] ⏭️  Skipping duplicate job', { jobLifecycleId: job._id });
      }
    }

    logger.debug('[SSE-READER] 📍 Checking job.parse.completed branch', { eventType: type });
    if (type === 'job.parse.completed') {
      const jobLifecycleId = payload.jobLifecycleId;
      logger.info('[SSE-READER] ✅ Parse completed', { jobLifecycleId });
      if (jobLifecycleId) {
        // Merge S2 into queued job (handles S1+S2 near-simultaneous arrival)
        const queuedJob = this.jobQueue.find(j => j._id === jobLifecycleId);
        if (queuedJob) {
          Object.assign(queuedJob, payload);
        } else {
          this.emitEvent('job.parse.completed', payload);
        }
      } else {
        logger.warn('[SSE-READER] Received job.parse.completed without jobLifecycleId, skipping', { payload });
      }
    }

    logger.debug('[SSE-READER] 📍 Checking job.route.queued branch', { eventType: type });
    if (type === 'job.route.queued') {
      logger.debug('[SSE-READER] 🔔 Entering job.route.queued handler', {
        hasPayload: !!payload,
        jobLifecycleId: payload?.jobLifecycleId,
      });
      const jobLifecycleId = payload.jobLifecycleId;
      logger.info('[SSE-READER] ✓ Job queued', { jobLifecycleId });
      if (jobLifecycleId) {
        logger.debug('[SSE-READER] 🔔 Adding to processedJobLifecycleIds and emitting event', { jobLifecycleId });
        this.addProcessedId(jobLifecycleId);
        this.emitEvent('job.route.queued', payload);
        logger.info('[SSE-READER] ✅ job.route.queued event emitted', { jobLifecycleId });
      } else {
        logger.warn('[SSE-READER] ⚠️ job.route.queued without jobLifecycleId, skipping', { payload });
      }
    }

    logger.debug('[SSE-READER] 📍 Checking job.route.trashed branch', { eventType: type });
    if (type === 'job.route.trashed') {
      logger.debug('[SSE-READER] 🔔 Entering job.route.trashed handler', {
        hasPayload: !!payload,
        jobLifecycleId: payload?.jobLifecycleId,
      });
      const jobLifecycleId = payload.jobLifecycleId;
      logger.info('[SSE-READER] ✓ Job trashed', { jobLifecycleId });
      if (jobLifecycleId) {
        logger.debug('[SSE-READER] 🔔 Adding to processedJobLifecycleIds and emitting event', { jobLifecycleId });
        this.addProcessedId(jobLifecycleId);
        this.emitEvent('job.route.trashed', payload);
        logger.info('[SSE-READER] ✅ job.route.trashed event emitted', { jobLifecycleId });
      } else {
        logger.warn('[SSE-READER] ⚠️ job.route.trashed without jobLifecycleId, skipping', { payload });
      }
    }

    logger.debug('[SSE-READER] 📍 Checking job.parse.failed branch', { eventType: type });
    if (type === 'job.parse.failed') {
      const jobLifecycleId = payload.jobLifecycleId;
      logger.warn('[SSE-READER] ❌ Job parse failed', { jobLifecycleId, error: payload.error });
      if (jobLifecycleId) {
        this.addProcessedId(jobLifecycleId);
        this.emitEvent('job.parse.failed', payload);
      }
    }

    logger.debug('[SSE-READER] 📍 Checking job.route.failed branch', { eventType: type });
    if (type === 'job.route.failed') {
      const jobLifecycleId = payload.jobLifecycleId;
      logger.warn('[SSE-READER] ❌ Job route failed', { jobLifecycleId, error: payload.error });
      if (jobLifecycleId) {
        this.addProcessedId(jobLifecycleId);
        this.emitEvent('job.route.failed', payload);
      }
    }
    logger.debug('[SSE-READER] ✅ handleSseEvent completed', { eventType: type });
  }

  private addProcessedId(id: string): void {
    this.processedJobLifecycleIds.add(id);
    if (this.processedJobLifecycleIds.size > PROCESSED_IDS_MAX_SIZE) {
      const toRemove = this.processedJobLifecycleIds.size - PROCESSED_IDS_MAX_SIZE;
      let count = 0;
      for (const existing of this.processedJobLifecycleIds) {
        if (count >= toRemove) break;
        this.processedJobLifecycleIds.delete(existing);
        count++;
      }
    }
  }

  /**
   * Get queue depth (for debugging).
   */
  getQueueDepth(): number {
    return this.jobQueue.length;
  }

  /**
   * Peek at the front of the queue without removing (for validation).
   * Used by Signal listeners to check if job is at queue[0].
   */
  peekNextJob(): Job | null {
    return this.jobQueue.length > 0 ? this.jobQueue[0] : null;
  }
}
