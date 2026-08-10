import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';
import { JobStage, JobSource } from '../../../../src/domain/types/job-lifecycle.js';
import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import type { GmailClient } from '../../../../src/infrastructure/inbound/web/webhook-adapter.js';

const S1_EMAIL_HTML = `<div data-source="topcv">
<a class="job-item-link" href="/viec-lam/software-engineer">
<div class="title"><span>Software Engineer</span></div>
<div class="company"><span>TestCo</span></div>
</a></div>`;

const S2_DETAIL_HTML = `<div class="job-detail__info--title"><h1>Full Stack</h1></div>
<div class="company-name-label"><a class="name">FullCo</a></div>
<h3>Mô tả công việc</h3>
<div class="job-description__item--content">TypeScript and Node.js developer</div>`;

/**
 * Webhook-to-completion saga through the production composition root: a real
 * PubSub push drives the real WebhookAdapter → real JobIngestor
 * (real Mongo + real RMQ adapters), and the S1→S3→S4 signals are asserted on
 * the real wired-up bus. Gmail is substituted with a plain transport fake
 * (no `vi.fn`); no adapter ports are mocked.
 */
describe('Webhook-to-completion saga (S1->S2->S3->S4)', () => {
  let tc: TestContainer;
  let port: number;
  let gmail: GmailClient;

  const freshPort = () => 21000 + Math.floor(Math.random() * 10000);

  beforeAll(async () => {
    gmail = {
      getMessage: async () => ({}),
      extractHeader: () => '',
      extractBody: () => S1_EMAIL_HTML,
      getMessagesSinceHistory: async () => ['wh-saga-msg'],
    };
    tc = await createTestContainer({ ns: 'webhook-to-completion', gmail });
    await tc.start();
    port = freshPort();
    tc.container.webhookAdapter.start(port, '/webhook');
  }, 120000);

  afterAll(async () => {
    await tc.container.webhookAdapter.stop();
    await tc.stop();
  });

  function postJson(path: string, body: unknown): Promise<number> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
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
        (res) => resolve(res.statusCode ?? 0)
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  it('GIVEN the Webhook precondition WHEN a PubSub push hits the real Webhook THEN body is ingested and GENERATED is republished through the real RMQ bus (S1)', async () => {
    const pubsubData = Buffer.from(
      JSON.stringify({ historyId: 'saga-1', emailAddress: 'x@y.com' })
    ).toString('base64');
    const handle = await tc.bus.setup([ActionEvent.GENERATED]);

    const status = await postJson('/webhook', {
      message: { data: pubsubData },
      subscription: 'sub',
    });
    expect(status).toBe(202);

    const signal = await handle.msg();
    expect(signal._id).toMatch(/^wh-saga-msg-job-/);
    expect(signal.role).toBe('Software Engineer');
    expect(signal.company).toBe('TestCo');
    expect(signal.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('GIVEN the Webhook precondition WHEN a raw messageId push hits the real Webhook THEN body is ingested and GENERATED is republished with job lifecycle metadata (S1)', async () => {
    const handle = await tc.bus.setup([ActionEvent.GENERATED]);

    const status = await postJson('/webhook', { messageId: 'wh-saga-msg' });
    expect(status).toBe(202);

    const signal = await handle.msg();
    expect(signal._id).toMatch(/^wh-saga-msg-job-/);
    expect(signal.role).toBe('Software Engineer');
  });

  it('GIVEN the Webhook precondition WHEN S1 seeds a partial job THEN full-parse + queue resolution on the same container complete the saga through real signals (S2+S3)', async () => {
    const genHandle = await tc.bus.setup([ActionEvent.GENERATED]);
    await postJson('/webhook', { messageId: 'wh-saga-msg' });
    const generated = await genHandle.msg();
    const jobLifecycleId = generated._id;

    const compHandle = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      S2_DETAIL_HTML,
      jobLifecycleId
    );
    const completed = await compHandle.msg();
    expect(completed.job._id).toBe(jobLifecycleId);
    expect(completed.job.stage).toBe(JobStage.FULL_PARSED);

    const queuedHandle = await tc.bus.setup([ActionEvent.QUEUED]);
    await tc.ingestor.processResolution(jobLifecycleId, 'queue');
    const queued = await queuedHandle.msg();
    expect(queued.jobLifecycleId).toBe(jobLifecycleId);
  });

  it('GIVEN the Webhook precondition WHEN S1 seeds a partial job THEN trash resolution on the same container emits TRASHED (S4)', async () => {
    const genHandle = await tc.bus.setup([ActionEvent.GENERATED]);
    await postJson('/webhook', { messageId: 'wh-saga-msg' });
    const generated = await genHandle.msg();
    const jobLifecycleId = generated._id;

    const trashHandle = await tc.bus.setup([ActionEvent.TRASHED]);
    await tc.ingestor.processResolution(jobLifecycleId, 'trash');
    const trashed = await trashHandle.msg();
    expect(trashed.jobLifecycleId).toBe(jobLifecycleId);
  });
});
