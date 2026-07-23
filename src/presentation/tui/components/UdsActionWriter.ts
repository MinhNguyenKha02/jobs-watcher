/**
 * UDS Action Writer
 *
 * Sends operator actions and clipboard ingestion requests to the server via UDS.
 * Handles queue, trash, skip, clipboard ingest, and edit_generated actions.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';

import { clipboardGetter } from '../services/clipboard-getter.js';
import { createLogger } from '../../../infrastructure/outbound/logging/logger.js';
import { postJsonOverUds, type UdsRequestOptions } from '../../../infrastructure/utils/uds-http.js';

const logger = createLogger('UdsAction');

export enum OperatorAction {
  QUEUE = 'queue',
  TRASH = 'trash',
}

export interface ActionPayload {
  jobLifecycleId: string;
  action: OperatorAction;
  editedKVs?: Record<string, unknown>;
  generatedPath?: string;
  source?: string;
}

export class UdsActionWriter {
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
  async queue(jobLifecycleId: string, editedKVs?: Record<string, unknown>, job?: any): Promise<void> {
    const payload: ActionPayload = {
      jobLifecycleId,
      action: OperatorAction.QUEUE,
      editedKVs,
      source: 'ops-tui',
    };
    
    await this.sendAction(payload);
  }

  /**
   * Send a trash action for a job.
   */
  async trash(jobLifecycleId: string, editedKVs?: Record<string, unknown>, job?: any): Promise<void> {
    const payload: ActionPayload = {
      jobLifecycleId,
      action: OperatorAction.TRASH,
      editedKVs,
      source: 'ops-tui',
    };
    
    await this.sendAction(payload);
  }

  async webhookIngest(jobLifecycleId?: string): Promise<string> {
    try {
      const entries = await clipboardGetter();
      if (!entries || entries.length === 0) {
        throw new Error('Clipboard is empty or no new content');
      }

      const html = String(entries[0]).trim();
      if (!html) {
        throw new Error('Clipboard content is empty');
      }

      // Create a hash of the clipboard content for deduplication tracking
      const hash = createHash('sha256').update(html).digest('hex');

      logger.debug('Pasting HTML from clipboard (webhook stage 2)', { size: html.length, hash: hash.substring(0, 8), jobLifecycleId });

      // POST to /internal/ingest?webhook=true endpoint
      const ingestOpts: UdsRequestOptions = {
        socketPath: this.socketPath,
        path: '/internal/ingest?webhook=true',
        method: 'POST',
        headers: this.token ? { 'x-internal-token': this.token } : {},
        timeoutMs: 10000,
      };

      const ingestPayload: Record<string, any> = {
        html,
        source: 'webhook-clipboard',
        meta: {
          hash,
          size: html.length,
          timestamp: new Date().toISOString(),
        },
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
      return html;
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
        logger.debug('Action sent', { action: payload.action, jobLifecycleId: payload.jobLifecycleId });
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
          await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt - 1)));
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
