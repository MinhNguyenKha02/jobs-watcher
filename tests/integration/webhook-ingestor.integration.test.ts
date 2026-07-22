import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();

const { default: JobIngestor } = await import('../../src/application/ingestor.js');
const { EventDrivenWebhook } = await import('../../src/infrastructure/inbound/web/event-webhook.js' );

const SAMPLE_HTML = `<html><body>Job alert: Senior Engineer at Acme Inc</body></html>`;

describe('Webhook → Ingestor → MongoDB (full pipeline)', () => {
  let storage: any;
  let adapter: MongoDBStorageAdapter;
  let mockGmail: any;
  let webhook: EventDrivenWebhook;
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger,
    });
    await adapter.connect();

    ingestor = new JobIngestor(adapter);

    mockGmail = {
      getMessage: vi.fn().mockResolvedValue({
        id: 'msg-test-1',
        threadId: 'thread-test-1',
        payload: { headers: [], body: { data: '' } },
      }),
      extractHeader: vi.fn((_msg: any, name: string) => {
        const headers: Record<string, string> = {
          'Subject': 'Job Alert: Junior Backend Engineer with TypeScript',
          'From': 'jobs@acme.com',
          'To': 'me@test.com',
        };
        return headers[name] || '';
      }),
      extractBody: vi.fn().mockReturnValue(SAMPLE_HTML),
      getLabelId: vi.fn().mockResolvedValue('LABEL_TEST'),
      listMessagesByLabel: vi.fn().mockResolvedValue([]),
      getMessagesSinceHistory: vi.fn().mockResolvedValue([]),
    };

    webhook = new EventDrivenWebhook(mockGmail, {
      storage: adapter,
      jobIngestor: ingestor,
      profile: { name: 'Test', role: 'Engineer', skills: ['TypeScript'] } as any,
    });
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  it('calls ingestor directly to verify storage', async () => {
    const col = (adapter as any).jobLifecycleCollection;
    const before = await col.countDocuments({});

    const upsertSpy = vi.spyOn(adapter, 'upsertJobLifecycle');

    await ingestor.processIngestCommand({
      source: 'browser-auto' as any,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: SAMPLE_HTML,
      metadata: { subject: 'Junior Backend Engineer', messageId: 'direct-test-1' },
      receivedAt: new Date(),
    });

    const after = await col.countDocuments({});
    expect(after).toBeGreaterThan(before);
  });

  it('processes a job notification end-to-end via webhook', async () => {
    const col = (adapter as any).jobLifecycleCollection;
    const before = await col.countDocuments({});

    webhook.processJobNotification({ messageId: 'msg-test-1' });
    await new Promise(r => setTimeout(r, 500));

    const after = await col.countDocuments({});
    expect(after).toBeGreaterThan(before);
  });

  it('skips duplicate messageId', async () => {
    const col = (adapter as any).jobLifecycleCollection;
    const before = await col.countDocuments({});

    webhook.processJobNotification({ messageId: 'msg-test-1' });
    await new Promise(r => setTimeout(r, 500));

    const after = await col.countDocuments({});
    expect(after).toBe(before);
  });

  it('processes a Pub/Sub envelope with historyId', async () => {
    const historyBody = {
      message: {
        data: Buffer.from(JSON.stringify({
          historyId: '67890',
          messageId: 'msg-pubsub-2',
        })).toString('base64'),
      },
    };

    mockGmail.getMessage.mockResolvedValueOnce({
      id: 'msg-pubsub-2',
      threadId: 'thread-pubsub-2',
    });
    mockGmail.extractHeader.mockReturnValueOnce('Junior Frontend Engineer with TypeScript');
    mockGmail.extractHeader.mockReturnValueOnce('jobs@different.com');
    mockGmail.extractHeader.mockReturnValueOnce('me@test.com');

    const col = (adapter as any).jobLifecycleCollection;
    const before = await col.countDocuments({});

    webhook.processJobNotification(historyBody);
    await new Promise(r => setTimeout(r, 1500));

    const after = await col.countDocuments({});
    expect(after).toBeGreaterThan(before);
  });
});
