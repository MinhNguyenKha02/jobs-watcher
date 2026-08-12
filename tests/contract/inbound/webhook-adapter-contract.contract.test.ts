import http from 'http';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { buildDaemonContainer } from '../../../src/application/container.js';
import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';
import type {
  GmailClient,
  WebhookAdapter,
} from '../../../src/infrastructure/inbound/web/webhook-adapter.js';

const CLIPBOARD_HTML = `<html><body>
<div class="job-detail__info--title"><h1>Software Engineer</h1></div>
<div class="company-name-label"><a class="name">WebhookCo</a></div>
<p>TypeScript developer</p>
</body></html>`;

function makeGmailClient(overrides: Record<string, unknown> = {}): GmailClient {
  return {
    getMessage: vi.fn().mockResolvedValue({}),
    extractHeader: vi.fn(() => ''),
    extractBody: vi.fn(() => CLIPBOARD_HTML),
    getMessagesSinceHistory: vi.fn().mockResolvedValue(['msg-history-1']),
    ...overrides,
  };
}

function madeIngestor(): IngestorPort {
  return { processIngest: vi.fn(), processResolution: vi.fn() };
}

async function postJson(
  port: number,
  path: string,
  body: unknown
): Promise<{ status: number; data: any }> {
  const data = JSON.stringify(body);
  const attempts = 10;
  for (let i = 0; i < attempts; i++) {
    try {
      return await new Promise<{ status: number; data: any }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path,
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
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('unreachable');
}

function listen(adapter: WebhookAdapter, port: number): Promise<void> {
  return new Promise((resolve) => {
    adapter.start(port, '/webhook');
    setTimeout(resolve, 200);
  });
}

describe('PRC-006 — Webhook adapter contract', () => {
  let adapter: WebhookAdapter;

  const freshPort = () => 20000 + Math.floor(Math.random() * 10000);

  afterEach(async () => {
    if (adapter) await adapter.stop();
  });

  /**
   * Boot the real WebhookAdapter through the production composition root with a
   * scripted `ports.ingestor` binding + gmail transport seam (never `start()`),
   * so the adapter under test is the container-resolved one.
   */
  function boot(gmail: GmailClient, ingestor: IngestorPort) {
    const container = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: 'mongodb://localhost/jw-webhook', dbName: 'unit' },
        rabbitmq: {
          url: process.env.RABBITMQ_URL || 'amqp://localhost',
          exchange: 'jobs.events.ct',
        },
        uds: { socketPath: '/tmp/jobs-watcher-webhook.sock', token: 'ct-token' },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-webhook-assets' },
      },
      { ports: { ingestor }, gmail }
    );
    adapter = container.webhookAdapter;
    return { gmail, ingestor };
  }

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN PubSub push resolves history → message → body → ingestor processIngest with BROWSER_AUTO PARTIAL_PARSED (S1)', async () => {
    const port = freshPort();
    const { gmail, ingestor } = boot(makeGmailClient(), madeIngestor());
    await listen(adapter, port);

    const pubsubData = Buffer.from(
      JSON.stringify({ historyId: '12345', emailAddress: 'x@y.com' })
    ).toString('base64');
    const res = await postJson(port, '/webhook', {
      message: { data: pubsubData },
      subscription: 'sub',
    });

    expect(res.status).toBe(202);
    expect(gmail.getMessagesSinceHistory).toHaveBeenCalledWith('12345');
    expect(gmail.getMessage).toHaveBeenCalledWith('msg-history-1');
    expect(ingestor.processIngest).toHaveBeenCalledWith(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      CLIPBOARD_HTML,
      undefined,
      expect.objectContaining({ messageId: 'msg-history-1' })
    );
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN simulated push with raw messageId → getMessage → processIngest', async () => {
    const port = freshPort();
    const gmail = makeGmailClient();
    const ingestor = { processIngest: vi.fn(), processResolution: vi.fn() };
    boot(gmail, ingestor);
    await listen(adapter, port);

    const res = await postJson(port, '/webhook', { messageId: 'sim-msg-1' });

    expect(res.status).toBe(202);
    expect(gmail.getMessage).toHaveBeenCalledWith('sim-msg-1');
    expect(ingestor.processIngest).toHaveBeenCalled();
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN invalid base64 pubsub data → no messageId → 202 accepted with empty messageId, no ingest', async () => {
    const port = freshPort();
    const gmail = makeGmailClient();
    const ingestor = { processIngest: vi.fn(), processResolution: vi.fn() };
    boot(gmail, ingestor);
    await listen(adapter, port);

    const res = await postJson(port, '/webhook', {
      message: { data: '%%not-base64-json%%' },
      subscription: 'sub',
    });

    expect(res.status).toBe(202);
    expect(res.data.messageId).toBe('');
    expect(ingestor.processIngest).not.toHaveBeenCalled();
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN malformed payload (no message / no messageId) → 202 accepted, no ingest, no crash', async () => {
    const port = freshPort();
    const gmail = makeGmailClient();
    const ingestor = { processIngest: vi.fn(), processResolution: vi.fn() };
    boot(gmail, ingestor);
    await listen(adapter, port);

    const res = await postJson(port, '/webhook', {});

    expect(res.status).toBe(202);
    expect(res.data.messageId).toBe('');
    expect(ingestor.processIngest).not.toHaveBeenCalled();
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN empty extracted body → 202 accepted, no ingest (graceful)', async () => {
    const port = freshPort();
    const gmail = makeGmailClient({ extractBody: vi.fn(() => '') });
    const ingestor = { processIngest: vi.fn(), processResolution: vi.fn() };
    boot(gmail, ingestor);
    await listen(adapter, port);

    const res = await postJson(port, '/webhook', { messageId: 'empty-body-msg' });

    expect(res.status).toBe(202);
    expect(ingestor.processIngest).not.toHaveBeenCalled();
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN GmailClient failure → 500 error response (no silent swallow)', async () => {
    const port = freshPort();
    const gmail = makeGmailClient({
      getMessage: vi.fn().mockRejectedValue(new Error('gmail down')),
    });
    const ingestor = { processIngest: vi.fn(), processResolution: vi.fn() };
    boot(gmail, ingestor);
    await listen(adapter, port);

    const res = await postJson(port, '/webhook', { messageId: 'down-msg' });

    expect(res.status).toBe(500);
    expect(res.data.status).toBe('error');
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN ingestor failure → 500 error response', async () => {
    const port = freshPort();
    const gmail = makeGmailClient();
    const ingestor = {
      processIngest: vi.fn().mockRejectedValue(new Error('ingestor boom')),
      processResolution: vi.fn(),
    };
    boot(gmail, ingestor);
    await listen(adapter, port);

    const res = await postJson(port, '/webhook', { messageId: 'boom-msg' });

    expect(res.status).toBe(500);
    expect(res.data.status).toBe('error');
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN extractHeader supplies subject/from/to metadata to processIngest', async () => {
    const port = freshPort();
    const gmail = makeGmailClient({
      extractHeader: vi.fn(
        (_m: unknown, name: string) =>
          ({
            subject: 'Re: Job Alert',
            from: 'jobs@topcv.vn',
            to: 'me@dev.vn',
            'message-id': 'thr-42',
          })[name] || ''
      ),
    });
    const ingestor = { processIngest: vi.fn(), processResolution: vi.fn() };
    boot(gmail, ingestor);
    await listen(adapter, port);

    await postJson(port, '/webhook', { messageId: 'meta-msg' });

    const args = ingestor.processIngest.mock.calls[0] as any[];
    expect(args[4]).toEqual(
      expect.objectContaining({ subject: 'Re: Job Alert', from: 'jobs@topcv.vn', to: 'me@dev.vn' })
    );
  });
});
