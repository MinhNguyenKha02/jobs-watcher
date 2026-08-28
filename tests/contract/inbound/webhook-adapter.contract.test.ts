import http from 'http';

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';

import { buildDaemonContainer } from '../../../src/application/container.js';
import { JobStage } from '../../../src/domain/types/job-lifecycle.js';
import type {
  GmailClient,
  WebhookAdapter,
} from '../../../src/infrastructure/inbound/web/webhook-adapter.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

const S1_EMAIL_HTML = `<div data-source="topcv">
<a class="job-item-link" href="/viec-lam/software-engineer">
<div class="title"><span>Software Engineer</span></div>
<div class="company"><span>TestCo</span></div>
</a></div>`;

/**
 * Webhook adapter contract through the production composition root: real PubSub
 * push → real WebhookAdapter → real JobIngestor (real Mongo + real RMQ
 * adapters). Gmail is a plain transport fake (no `vi.fn`); no adapter ports are
 * mocked. Assertions are on the real wired-up bus (GENERATED / PARSE_COMPLETED /
 * QUEUED / TRASHED) and the persisted Mongo docs.
 *
 * Scope: S1 generation (a), negative push handling (b), transport failure (c).
 * S2+S3/S4 completion sagas are intentionally NOT re-proven here — they are
 * owned by rmq-pubsub + uds-adapter contracts and the path rings (integ/e2e).
 */
describe('Webhook adapter contract — real PubSub push + real ingestor via testdaemoncontainer', () => {
  let daemon: TestDaemonContainer;
  let adapter: WebhookAdapter;
  let tui: TuiTestContainer;

  const freshPort = () => 21000 + Math.floor(Math.random() * 10000);

  function makeGmail(overrides: Partial<GmailClient> = {}): GmailClient {
    return {
      getMessage: async () => ({}),
      extractHeader: () => '',
      extractBody: () => S1_EMAIL_HTML,
      getMessagesSinceHistory: async () => ['msg-history-1'],
      ...overrides,
    };
  }

  function listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      adapter.start(port, '/webhook');
      setTimeout(resolve, 200);
    });
  }

  async function postJson(port: number, body: unknown): Promise<{ status: number; data: any }> {
    const data = JSON.stringify(body);
    for (let i = 0; i < 10; i++) {
      try {
        return await new Promise<{ status: number; data: any }>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port,
              path: '/webhook',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
              },
            },
            (res) => {
              let raw = '';
              res.on('data', (c) => (raw += c));
              res.on('end', () =>
                resolve({ status: res.statusCode ?? 0, data: raw ? JSON.parse(raw) : null })
              );
            }
          );
          req.on('error', reject);
          req.write(data);
          req.end();
        });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const transient =
          code === 'ECONNREFUSED' ||
          code === 'ECONNRESET' ||
          (err as Error).message.includes('socket hang up');
        if (!transient || i === 9) throw err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('unreachable');
  }

  async function expectNoGeneratedEvent(timeoutMs = 3000): Promise<void> {
    await expect(
      waitFor(() => tui.ipc.read().stage === JobStage.PARTIAL_PARSED, timeoutMs)
    ).rejects.toThrow(/timed out/);
  }

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'webhook-adapter' });
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'webhook-adapter' });
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    tui.ipc.clear();
  });

  afterEach(async () => {
    if (adapter) await adapter.stop();
  });

  /** Real WebhookAdapter through the production composition root bound to the real ingestor + a plain gmail fake. */
  function bootWebhook(gmail: GmailClient): WebhookAdapter {
    const container = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: daemon.storage.uri, dbName: daemon.storage.dbName },
        rabbitmq: { url: daemon.rmq.exchange, exchange: daemon.rmq.exchange },
        uds: { socketPath: `/tmp/jobs-watcher-webhook-${Date.now()}.sock`, token: 'ct-token' },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-webhook-assets' },
      },
      {
        ports: {
          ingestor: {
            processIngest: daemon.apps.ingest.processIngest,
            processResolution: daemon.apps.ingest.processResolution,
          },
        },
        gmail,
      }
    );
    return container.webhookAdapter;
  }

  describe('(a) S1 generation — PubSub push → GENERATED via the real bus', () => {
    it('GIVEN a PubSub push WHEN it carries a historyId THEN history → message → body → GENERATED with role/company/stage (S1)', async () => {
      const port = freshPort();
      adapter = bootWebhook(makeGmail());
      await listen(port);

      const res = await postJson(port, {
        message: {
          data: Buffer.from(
            JSON.stringify({ historyId: '12345', emailAddress: 'x@y.com' })
          ).toString('base64'),
        },
        subscription: 'sub',
      });
      expect(res.status).toBe(202);

      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().stage === JobStage.PARTIAL_PARSED
      );
      const cur = tui.ipc.read();
      expect(cur.jobLifecycleId).toMatch(/^msg-history-1-job-/);
      expect(cur.job?.role).toBe('Software Engineer');
      expect(cur.job?.company).toBe('TestCo');
      expect(cur.stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('GIVEN a simulated push WHEN it carries a raw messageId THEN getMessage → GENERATED on the real bus (S1)', async () => {
      const port = freshPort();
      adapter = bootWebhook(makeGmail());
      await listen(port);

      const res = await postJson(port, { messageId: 'msg-history-1' });
      expect(res.status).toBe(202);

      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().stage === JobStage.PARTIAL_PARSED
      );
      const cur = tui.ipc.read();
      expect(cur.jobLifecycleId).toMatch(/^msg-history-1-job-/);
      expect(cur.job?.role).toBe('Software Engineer');
    });

    it('GIVEN the metadata precondition WHEN extractHeader supplies subject/from/to THEN the GENERATED doc carries them (S1)', async () => {
      const port = freshPort();
      adapter = bootWebhook(
        makeGmail({
          extractHeader: (_m: unknown, name: string) =>
            ({
              subject: 'Re: Job Alert',
              from: 'jobs@topcv.vn',
              to: 'me@dev.vn',
              'message-id': 'thr-42',
            })[name] || '',
        })
      );
      await listen(port);

      await postJson(port, { messageId: 'meta-msg' });

      await waitFor(
        () =>
          tui.ipc.read().jobLifecycleId !== null && tui.ipc.read().stage === JobStage.PARTIAL_PARSED
      );
      const cur = tui.ipc.read();
      const id = cur.jobLifecycleId as string;
      const doc = await daemon.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.gmailMeta).toMatchObject({
        messageId: 'meta-msg',
        threadId: 'thr-42',
        from: 'jobs@topcv.vn',
        to: 'me@dev.vn',
        subject: 'Re: Job Alert',
      });
    });
  });

  describe('(b) negative push handling — 202 accepted, no ingest', () => {
    it('GIVEN invalid base64 pubsub data WHEN a push arrives THEN 202 accepted with empty messageId and no GENERATED', async () => {
      const port = freshPort();
      adapter = bootWebhook(makeGmail());
      await listen(port);

      const res = await postJson(port, {
        message: { data: '%%not-base64-json%%' },
        subscription: 'sub',
      });
      expect(res.status).toBe(202);
      expect(res.data.messageId).toBe('');
      await expectNoGeneratedEvent();
    });

    it('GIVEN a malformed payload (no message / no messageId) WHEN a push arrives THEN 202 accepted, no ingest, no crash', async () => {
      const port = freshPort();
      adapter = bootWebhook(makeGmail());
      await listen(port);

      const res = await postJson(port, {});
      expect(res.status).toBe(202);
      expect(res.data.messageId).toBe('');
      await expectNoGeneratedEvent();
    });

    it('GIVEN an empty extracted body WHEN a push arrives THEN 202 accepted with the messageId and no GENERATED', async () => {
      const port = freshPort();
      adapter = bootWebhook(makeGmail({ extractBody: () => '' }));
      await listen(port);

      const res = await postJson(port, { messageId: 'empty-body-msg' });
      expect(res.status).toBe(202);
      expect(res.data.messageId).toBe('empty-body-msg');
      await expectNoGeneratedEvent();
    });
  });

  describe('(c) transport failure — GmailClient down → 500 error response', () => {
    it('GIVEN the Gmail transport failing WHEN a push arrives THEN 500 error response (no silent swallow)', async () => {
      const port = freshPort();
      adapter = bootWebhook(
        makeGmail({ getMessage: async () => Promise.reject(new Error('gmail down')) })
      );
      await listen(port);

      const res = await postJson(port, { messageId: 'down-msg' });
      expect(res.status).toBe(500);
      expect(res.data.status).toBe('error');
    });
  });
});
