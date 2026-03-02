import { fn } from 'jest-mock';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { EventDrivenWebhook } from '../../../src/services/event-webhook.js';
import { MongoDBStorageAdapter, StorageAdapterConfig } from '../../../src/services/storage/mongodb-storage-adapter.js';
// Minimal mock GmailService for constructor
class MockGmailService {
  getLabelId = fn();
  listMessagesByLabel = fn();
  getMessage = fn();
  extractHeader = fn();
  extractBody = fn();
}
import type { Job } from '../../../src/types.js';
import type { JobPresenter, JobPresentationResult } from '../../../src/application/job-processor.js';
import type { ActionType, EnrichedJobData } from '../../../src/ui/hooks/useJobState.js';
// Headless presenter to avoid Ink import in test context
class HeadlessJobPresenter implements JobPresenter<ActionType, EnrichedJobData> {
  async present(job: Job): Promise<JobPresentationResult<ActionType, EnrichedJobData>> {
    return { action: 'queue' as ActionType, payload: undefined };
  }
}

describe('EventDrivenWebhook (integration)', () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let adapter: MongoDBStorageAdapter;
  let webhook: EventDrivenWebhook;
  let gmailService: MockGmailService;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
    adapter = new MongoDBStorageAdapter({
      mongoUri: uri,
      dbName: 'test_db',
      logger: { debug: fn(), info: fn(), warn: fn(), error: fn() },
    } as StorageAdapterConfig);
    await adapter.connect();
    gmailService = new MockGmailService();
    webhook = new EventDrivenWebhook(gmailService as any, {
      storage: adapter,
      presenter: new HeadlessJobPresenter(),
    });
  });

  afterAll(async () => {
    if (adapter) await adapter.disconnect();
    if (mongod) await mongod.stop();
  });

  it('initializes with storage and can connect/disconnect', async () => {
    expect(webhook).toBeInstanceOf(EventDrivenWebhook);
    await webhook.connectStorage();
    await webhook.disconnectStorage();
  });
});
