import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import type { JobLifecycleDocument } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();

const now = new Date();

function makeDoc(overrides: Partial<JobLifecycleDocument> & { _id: string }): JobLifecycleDocument {
  return {
    _id: overrides._id,
    raw: overrides.raw || '<html>test</html>',
    stage: overrides.stage || JobStage.PARTIAL_PARSED,
    status: overrides.status || JobStatus.ENRICHING,
    source: overrides.source || JobSource.BROWSER_AUTO,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    stageTimestamp: overrides.stageTimestamp || now,
    company: overrides.company,
    role: overrides.role,
    ...overrides,
  };
}

describe('Ingestor <-> MongoDB storage (mongodb-memory-server)', () => {
  let storage: { mongod: any; client: any; uri: string; dbName: string; stop: () => Promise<void> } | null = null;
  let adapter: MongoDBStorageAdapter | null = null;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoDBStorageAdapter({
      mongoUri: storage.uri,
      dbName: storage.dbName,
      logger,
    });
    await adapter.connect();
  }, 120000);

  afterAll(async () => {
    if (adapter) await adapter.disconnect();
    if (storage) await storage.stop();
  });

  it('stores and retrieves a job lifecycle document', async () => {
    const doc = makeDoc({ _id: 'it-test-1', company: 'Acme Inc.', role: 'Senior Tester' });
    await adapter!.upsertJobLifecycle(doc);

    const found = await adapter!.findJobLifecycleById('it-test-1');
    expect(found).not.toBeNull();
    expect(found!.company).toBe('Acme Inc.');
    expect(found!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('upserts replaces existing document with same _id', async () => {
    const doc1 = makeDoc({ _id: 'it-upsert-1', company: 'UpsertCorp', role: 'Engineer', source: JobSource.MANUAL, stage: JobStage.PARTIAL_PARSED, rawPayload: 'v1' });
    await adapter!.upsertJobLifecycle(doc1);

    const doc2 = makeDoc({ _id: 'it-upsert-1', company: 'UpsertCorp', role: 'Engineer', source: JobSource.MANUAL, stage: JobStage.FULL_PARSED, rawPayload: 'v2' });
    await adapter!.upsertJobLifecycle(doc2);

    const all = await (adapter! as any).jobLifecycleCollection.find({ _id: 'it-upsert-1' }).toArray();
    expect(all).toHaveLength(1);
    expect(all[0].rawPayload).toBe('v2');
    expect(all[0].stage).toBe(JobStage.FULL_PARSED);
  });

  it('updates job status', async () => {
    const doc = makeDoc({ _id: 'it-status-1', company: 'StatusCorp', role: 'Dev', stage: JobStage.FULL_PARSED, status: JobStatus.ENRICHING });
    await adapter!.upsertJobLifecycle(doc);

    await adapter!.updateJobStatus('it-status-1', JobStatus.QUEUED);

    const updated = await adapter!.findJobLifecycleById('it-status-1');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(JobStatus.QUEUED);
  });

  it('creates required indexes on connect', async () => {
    const col = (adapter! as any).jobLifecycleCollection;
    const indexes = await col.indexes();
    const idIndex = indexes.find((i: any) => i.key?._id === 1);
    expect(idIndex).toBeDefined();
    const uniqueIndex = indexes.find((i: any) => i.name && i.name.startsWith('idx_role_company'));
    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex.unique).toBe(true);
  });
});
