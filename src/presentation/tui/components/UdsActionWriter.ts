/**
 * UDS Action Writer
 *
 * Sends operator actions and clipboard ingestion requests to the server via UDS.
 * Handles queue, trash, skip, clipboard ingest, and edit_generated actions.
 */

import fs from 'node:fs';

import { createLogger } from '../../../infrastructure/outbound/logging/logger.js';
import { postJsonOverUds, type UdsRequestOptions } from '../../../infrastructure/utils/uds-http.js';
import {
  OperatorAction,
  type ActionPayload,
  type ActionWriterPort,
  type WebhookIngestPayload,
} from '../ports/action-writer.port.js';

const logger = createLogger('UdsAction');

export class UdsActionWriter implements ActionWriterPort {
  private socketPath: string;
  private token: string | undefined;
  private udsOpts: UdsRequestOptions;

  constructor(socketPath: string, token?: string) {
    this.socketPath = socketPath;
    this.token = token;
    this.udsOpts = {
      socketPath,
      path: '/internal/action',
      method: 'POST',
      headers: token ? { 'x-internal-token': token } : {},
      timeoutMs: 10000,
    };
  }

  /**
   * Send a queue action for a job.
   */
  async queue(jobLifecycleId: string): Promise<void> {
    const payload: ActionPayload = {
      jobLifecycleId,
      action: OperatorAction.QUEUE,
    };

    await this.sendAction(payload);
  }

  /**
   * Send a trash action for a job.
   */
  async trash(jobLifecycleId: string): Promise<void> {
    const payload: ActionPayload = {
      jobLifecycleId,
      action: OperatorAction.TRASH,
    };

    await this.sendAction(payload);
  }

  /**
   * Send a direct-mode clipboard ingest ([i]) — html only, no jobLifecycleId.
   * Caller ([i]) owns the single clipboardGetter() read and passes html via arg.
   */
  async ingest(html: string): Promise<void> {
    const resolvedHtml = typeof html === 'string' ? html.trim() : '';
    if (!resolvedHtml) {
      throw new Error('Clipboard content is empty');
    }
    const ingestOpts: UdsRequestOptions = {
      socketPath: this.socketPath,
      path: '/internal/ingest',
      method: 'POST',
      headers: this.token ? { 'x-internal-token': this.token } : {},
      timeoutMs: 10000,
    };

    const res = await postJsonOverUds(ingestOpts, { webhook: false, html: resolvedHtml });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Ingest failed: ${res.statusCode} ${res.body}`);
    }

    logger.info('Clipboard ingestion triggered', { size: resolvedHtml.length });
  }

  /**
   * Send a queue-mode clipboard ingest ([c]) — html + jobLifecycleId, both required.
   * Caller ([c]) owns the single clipboardGetter() read and passes both via args.
   * No clipboard read here: empty html is an early-return error.
   */
  async webhookIngest(jobLifecycleId: string, html: string): Promise<string> {
    try {
      const resolvedHtml = typeof html === 'string' ? html.trim() : '';
      if (!jobLifecycleId || !resolvedHtml) {
        throw new Error('Clipboard content is empty');
      }

      logger.debug('Pasting HTML from clipboard (webhook stage 2)', {
        size: resolvedHtml.length,
        jobLifecycleId,
      });

      // POST to /internal/ingest?webhook=true endpoint
      const ingestOpts: UdsRequestOptions = {
        socketPath: this.socketPath,
        path: '/internal/ingest?webhook=true',
        method: 'POST',
        headers: this.token ? { 'x-internal-token': this.token } : {},
        timeoutMs: 10000,
      };

      const ingestPayload: WebhookIngestPayload = {
        html: resolvedHtml,
      };

      // Include jobLifecycleId if provided (for webhook stage 2 enrichment)
      if (jobLifecycleId) {
        ingestPayload.jobLifecycleId = jobLifecycleId;
      }

      const res = await postJsonOverUds(ingestOpts, ingestPayload);
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`Webhook ingest failed: ${res.statusCode} ${res.body}`);
      }

      logger.info('Webhook stage 2 clipboard ingest posted to server', { jobLifecycleId });
      return resolvedHtml;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Webhook ingest failed', { error: message });
      throw err;
    }
  }

  private async sendAction(payload: ActionPayload): Promise<void> {
    if (!fs.existsSync(this.socketPath)) {
      throw new Error(`UDS socket not found: ${this.socketPath}`);
    }
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await postJsonOverUds(this.udsOpts, payload);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          throw new Error(`Action failed: ${res.statusCode}`);
        }
        logger.debug('Action sent', {
          action: payload.action,
          jobLifecycleId: payload.jobLifecycleId,
        });
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) {
          logger.warn('Action failed, retrying', {
            jobLifecycleId: payload.jobLifecycleId,
            action: payload.action,
            attempt,
            maxRetries,
            error: message,
          });
          await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt - 1)));
        } else {
          logger.error('Action failed after max attempts', {
            jobLifecycleId: payload.jobLifecycleId,
            action: payload.action,
            maxRetries,
            error: message,
          });
          throw err;
        }
      }
    }
  }
}
