import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import amqplib from 'amqplib';

import type { JobLifecyclePort } from '../../src/application/ports/job-lifecycle.port.js';
import { ActionEvent } from '../../src/domain/types/action-event.js';
import {
  WebhookAdapter,
  type GmailClient,
} from '../../src/infrastructure/inbound/web/webhook-adapter.js';

import { topcvEmailHtmlMany, indeedEmailHtmlMany } from './html-fixtures.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TuiTestContainer,
} from './test-container.js';
import { postJson, udsHelpers } from './test-utils.js';

export { ActionEvent };

export interface E2eEvents {
  /**
   * Register an ephemeral exclusive-queue waiter directly on the namespaced
   * exchange (bypassing the TUI durable reader). Registration happens before
   * triggering so the exclusive queue holds any early publish for the awaited
   * `msg()`. Flat TUI surface has no `tui.rmq.consume`.
   */
  on(keys: ActionEvent[], timeoutMs?: number): Promise<{ msg(): Promise<any> }>;
}

export interface E2eArtifacts {
  /** Wait until the real AssetProducingAdapter has rendered a PDF into the container asset dir. */
  waitForPdf(timeoutMs?: number): Promise<string>;
}

export interface E2eAppOptions {
  /** Unique namespace: RMQ exchange + UDS socket + asset dir (per-file isolation). */
  ns: string;
  token?: string;
  startScheduler?: boolean;
  role?: string;
  company?: string;
  /**
   * The fake supports BOTH e-mail formats and dispatches per messageId:
   *  - ids containing `indeed`  → Indeed listing with a real detail url (S1 with url → scheduler s2c).
   *  - ids containing `topcv`   → TopCV alert without url (S1 → GENERATED).
   *  - anything else            → TopCV alert.
   */
  indeedUrl?: (role: string, company: string) => string;
  /** Per-message job override so one fake can serve a whole scenario matrix. */
  jobForMessage?: (messageId: string) => { role: string; company: string };
  /** Escape hatch: fully custom e-mail body for a messageId (highest priority). */
  emailHtml?: (messageId: string) => string;
}

export interface E2eUds {
  ingest(html: string, jobLifecycleId?: string): Promise<{ statusCode: number }>;
  action(jobLifecycleId: string, action: 'queue' | 'trash'): Promise<{ statusCode: number }>;
}

export interface E2eApp {
  events: E2eEvents;
  artifacts: E2eArtifacts;
  webhook: { post(messageId: string): Promise<{ status: number }> };
  uds: E2eUds;
  /** The real tui composition root (reader + ipc seam) sharing this app's ns. */
  tui: TuiTestContainer;
  /** Real job-lifecycle port for final mongo S3/S4 state assertions. */
  jobLifecycle: JobLifecyclePort;
  resetDb(): Promise<void>;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/**
 * In-process prod bootstrap for e2e scenarios. All system objects come from
 * the production composition root (`buildDaemonContainer`) with real adapters
 * (Mongo, RMQ, Playwright, UDS, asset/PdfRenderer). The ONLY fakes are the
 * external systems the prod bootstrap cannot talk to (gmail in front of the
 * webhook). e2e bodies call scenario verbs — no `new JobIngestor`, no
 * `container.resolve`, no injectable mocks.
 */
export async function createE2eApp(opts: E2eAppOptions): Promise<E2eApp> {
  const token = opts.token ?? 'e2e-internal-token';
  const role = opts.role ?? 'Software Engineer';
  const company = opts.company ?? 'E2eCanonicalCo';

  const daemon = await buildTestDaemonContainer({
    ns: opts.ns,
    startScheduler: opts.startScheduler ?? false,
  });
  await daemon.start();
  const tui = await buildTestTuiContainer({ ns: opts.ns });

  const gmail = {
    getMessage: async (msgId: string): Promise<unknown> => ({ messageId: msgId }),
    extractHeader: (_m: unknown, name: string) =>
      ({
        subject: 'Job Alert',
        from: 'jobs@topcv.vn',
        to: 'me@dev.vn',
        'message-id': 'thr-<message-id>',
      })[name] || '',
    extractBody: (m: unknown): string => {
      const msgId = (m as { messageId?: string } | undefined)?.messageId ?? '';
      if (opts.emailHtml) return opts.emailHtml(msgId);
      const job = opts.jobForMessage ? opts.jobForMessage(msgId) : { role, company };
      if (/indeed/i.test(msgId)) {
        const url = opts.indeedUrl
          ? opts.indeedUrl(job.role, job.company)
          : 'https://example.invalid/job';
        return indeedEmailHtmlMany([{ role: job.role, company: job.company, url }]);
      }
      return topcvEmailHtmlMany([{ role: job.role, company: job.company }]);
    },
    getMessagesSinceHistory: async (): Promise<string[]> => ['msg-history-1'],
  };

  const webhookPort = await freePort();
  const webhook = new WebhookAdapter(daemon.apps.ingest, gmail as unknown as GmailClient);
  await new Promise<void>((resolve) => {
    webhook.start(webhookPort, '/webhook');
    setTimeout(resolve, 250);
  });

  const uds: E2eUds = {
    ingest: (html, jobLifecycleId) =>
      udsHelpers(daemon.uds.socket, token).ingest(html, jobLifecycleId),
    action: async (jobLifecycleId, action) => {
      await tui.writer[action](jobLifecycleId);
      return { statusCode: 200 };
    },
  };

  const waitForPdf = (timeoutMs = 25000): Promise<string> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        let pdfs: string[] = [];
        try {
          pdfs = fs.readdirSync(daemon.assetDir).filter((f) => f.endsWith('.pdf'));
        } catch {
          /* dir not created yet */
        }
        if (pdfs.length > 0) {
          const newest = pdfs
            .map((f) => path.join(daemon.assetDir, f))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
          return resolve(newest);
        }
        if (Date.now() - start > timeoutMs)
          return reject(new Error('Timeout waiting for asset pdf'));
        setTimeout(poll, 250);
      };
      poll();
    });

  return {
    events: {
      // Flat TUI surface has no rmq.consume — open a fresh exclusive queue
      // directly via amqplib for payload proof, bypassing the TUI durable reader.
      on: (keys, timeoutMs = 10000) => {
        const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';
        const exchange = `jobs.events.int.${opts.ns}`;
        const pending: Promise<any> = (async () => {
          const conn = await amqplib.connect(RMQ_URL);
          const ch = await conn.createChannel();
          await ch.assertExchange(exchange, 'topic', { durable: true });
          const { queue } = await ch.assertQueue('', { exclusive: true, autoDelete: true });
          for (const key of keys) await ch.bindQueue(queue, exchange, key);
          try {
            const msg = await new Promise<any>((resolve, reject) => {
              const timer = setTimeout(
                () =>
                  reject(new Error(`Timeout waiting for message on ${exchange}:${keys.join('|')}`)),
                timeoutMs
              );
              ch.consume(
                queue,
                (m) => {
                  if (!m) return;
                  clearTimeout(timer);
                  ch.ack(m);
                  try {
                    resolve(JSON.parse(m.content.toString()));
                  } catch (e) {
                    reject(e);
                  }
                },
                { noAck: false }
              ).catch((e) => {
                clearTimeout(timer);
                reject(e);
              });
            });
            return msg;
          } finally {
            try {
              await ch.close();
            } catch {
              /* best-effort */
            }
            try {
              await (conn as any).close();
            } catch {
              /* best-effort */
            }
          }
        })();
        return Promise.resolve({ msg: () => pending });
      },
    },
    artifacts: { waitForPdf },
    webhook: {
      post: (messageId) => postJson(webhookPort, '/webhook', { messageId }),
    },
    uds,
    tui,
    jobLifecycle: daemon.jobLifecycle,
    resetDb: () => daemon.storage.clearDb(),
    stop: async () => {
      try {
        await webhook.stop();
      } catch {
        /* best-effort */
      }
      try {
        await tui.stop();
        await daemon.stop();
      } finally {
        // Per-suite cycle teardown: self-delete the 4 namespaced queues +
        // test exchange so e2e suites leave no residue (deleteQueues is
        // best-effort internally and never touches prod `jobs.events`).
        await tui.reader.deleteQueues();
      }
    },
  };
}
