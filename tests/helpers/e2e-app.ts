import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  WebhookAdapter,
  type GmailClient,
} from '../../src/infrastructure/inbound/web/webhook-adapter.js';
import { createTestContainer, type TestContainer } from './test-container.js';
import { postJson, udsHelpers } from './e2e-harness.js';
import { ActionEvent } from '../../src/domain/types/action-event.js';
import { topcvEmailHtmlMany, indeedEmailHtmlMany } from './html-fixtures.js';

export { ActionEvent };

export interface E2eEvents {
  /**
   * Bind a fresh exclusive RMQ queue to the given action routing keys (S1…S4)
   * and resolve with the first matching real event. Setup must complete before
   * triggering the system-under-test to avoid the bind-vs-publish race.
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
  tc: TestContainer;
  adapter: TestContainer['mongoJobLifecycleAdapter'];
  db: TestContainer['db'];
  events: E2eEvents;
  artifacts: E2eArtifacts;
  webhook: { post(messageId: string): Promise<{ status: number }> };
  uds: E2eUds;
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
 * the production composition root (`buildSystemContainer`) with real adapters
 * (Mongo, RMQ, Playwright, UDS, asset/PdfRenderer). The ONLY fakes are the
 * external systems the prod bootstrap cannot talk to (gmail in front of the
 * webhook). e2e bodies call scenario verbs — no `new JobIngestor`, no
 * `container.resolve`, no injectable mocks.
 */
export async function createE2eApp(opts: E2eAppOptions): Promise<E2eApp> {
  const token = opts.token ?? 'e2e-internal-token';
  const role = opts.role ?? 'Software Engineer';
  const company = opts.company ?? 'E2eCanonicalCo';

  const tc = await createTestContainer({
    ns: opts.ns,
    startScheduler: opts.startScheduler ?? false,
  });
  await tc.start();

  const gmail = {
    getMessage: async (msgId: string): Promise<unknown> => ({ messageId: msgId }),
    extractHeader: (_m: unknown, name: string) =>
      ({
        Subject: 'Job Alert',
        From: 'jobs@topcv.vn',
        To: 'me@dev.vn',
        'Message-ID': 'thr-<message-id>',
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
  const webhook = new WebhookAdapter(tc.ingestor, gmail as unknown as GmailClient);
  await new Promise<void>((resolve) => {
    webhook.start(webhookPort, '/webhook');
    setTimeout(resolve, 250);
  });

  const uds = udsHelpers(tc.socket, token);

  const waitForPdf = (timeoutMs = 25000): Promise<string> =>
    new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        let pdfs: string[] = [];
        try {
          pdfs = fs.readdirSync(tc.assetDir).filter((f) => f.endsWith('.pdf'));
        } catch {
          /* dir not created yet */
        }
        if (pdfs.length > 0) {
          const newest = pdfs
            .map((f) => path.join(tc.assetDir, f))
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
    tc,
    adapter: tc.mongoJobLifecycleAdapter,
    db: tc.db,
    events: {
      on: (keys, timeoutMs) => tc.bus.setup(keys, timeoutMs),
    },
    artifacts: { waitForPdf },
    webhook: {
      post: (messageId) => postJson(webhookPort, '/webhook', { messageId }),
    },
    uds,
    resetDb: () => tc.storage.clearDb(),
    stop: async () => {
      try {
        await webhook.stop();
      } catch {
        /* best-effort */
      }
      await tc.stop();
    },
  };
}
