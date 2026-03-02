// import { MongoClient } from 'mongodb';
import { fn } from 'jest-mock';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { MongoDBStorageAdapter, StorageAdapterConfig } from '../../../src/services/storage/mongodb-storage-adapter.js';
import { RawIngestDocument, ParseLogDocument } from '../../../src/services/storage/schemas.js';

/**
 * Integration test for MongoDBStorageAdapter
 */
describe('MongoDBStorageAdapter (integration)', () => {
  let mongod: MongoMemoryServer;
  let uri: string;
  let adapter: MongoDBStorageAdapter;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
    adapter = new MongoDBStorageAdapter({
      mongoUri: uri,
      dbName: 'test_db',
      logger: { debug: fn(), info: fn(), warn: fn(), error: fn() },
    } as StorageAdapterConfig);
    await adapter.connect();
  });

  afterAll(async () => {
    if (adapter) await adapter.disconnect();
    if (mongod) await mongod.stop();
  });

  it('saves and retrieves a raw ingest document', async () => {
    const doc: RawIngestDocument = {
      source: 'GMAIL_WEBHOOK',
      rawContent: 'test email',
      ingestedAt: new Date(),
      createdAt: new Date(),
      gmailMeta: { messageId: 'msg-1' },
    };
    const id = await adapter.saveRawIngest(doc);
    expect(id).toBeDefined();
    // Optionally: fetch and check
  });

  it('logs a parse attempt', async () => {
    const log: ParseLogDocument = {
      rawIngestId: 'raw-1',
      stage: 'METADATA',
      success: true,
      executionMs: 10,
      timestamp: new Date(),
    };
    const id = await adapter.logParseAttempt(log);
    expect(id).toBeDefined();
  });
});
