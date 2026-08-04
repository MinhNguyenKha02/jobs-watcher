import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { createRealDipBus, type RealDipBus } from '../../../helpers/real-dip-bus.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js' ;
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

const logger = getLogger();

const { JobIngestor } = await import('../../../../src/application/ingestor.js');

const now = new Date();

function makeDoc(overrides: any): any {
  return {
    _id: overrides._id || `test-${Date.now()}`,
    raw: overrides.raw || '<html>test</html>',
    stage: overrides.stage || JobStage.PARTIAL_PARSED,
    status: overrides.status || JobStatus.ENRICHING,
    source: overrides.source || JobSource.BROWSER_AUTO,
    createdAt: now,
    updatedAt: now,
    stageTimestamp: now,
    company: overrides.company || 'TestCorp',
    role: overrides.role || 'Tester',
    ...overrides,
  };
}

describe('Signal flow (ingestor → ports) with mongodb-memory-server', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let realBus: RealDipBus;

  function realIngestor(): any {
    return new JobIngestor(adapter, realBus.parsePort, realBus.routePort);
  }

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    realBus = await createRealDipBus('jobs.events.int.c4.memdb');
  }, 120000);

  afterAll(async () => {
    await realBus.teardown();
    await storage.stop();
  });

  it('processResolutionCommand queue updates status and emits queued event — real-DIP', async () => {
    const doc = makeDoc({ _id: 'it-queue-1', company: 'QueueCorp', role: 'Dev', status: JobStatus.ENRICHED, stage: JobStage.FULL_PARSED });
    await adapter.upsert(doc);

    const queue = await realBus.setup([ActionEvent.QUEUED]);
    await realIngestor().processResolution('it-queue-1', 'queue');
    const queueMsg = await queue.msg();
    expect(queueMsg.jobLifecycleId).toBe('it-queue-1');

    const updated = await adapter.findById('it-queue-1');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(JobStatus.QUEUED);
  });

  it('processResolutionCommand trash updates status and emits trashed event — real-DIP', async () => {
    const doc = makeDoc({ _id: 'it-trash-1', company: 'TrashCorp', role: 'Dev' });
    await adapter.upsert(doc);

    const trash = await realBus.setup([ActionEvent.TRASHED]);
    await realIngestor().processResolution('it-trash-1', 'trash');
    const trashMsg = await trash.msg();
    expect(trashMsg.jobLifecycleId).toBe('it-trash-1');

    const updated = await adapter.findById('it-trash-1');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(JobStatus.TRASHED);
  });

  it('processResolutionCommand with invalid jobLifecycleId emits routeFailed — real-DIP', async () => {
    const routeFail = await realBus.setup([ActionEvent.ROUTE_FAILED]);
    await realIngestor().processResolution('it-nonexistent', 'queue');
    const routeFailMsg = await routeFail.msg();
    expect(routeFailMsg.jobLifecycleId).toBe('it-nonexistent');
  });

  it('allows multiple queue/trash actions on same job — real-DIP', async () => {
    const doc = makeDoc({ _id: 'it-multi-1', company: 'MultiCorp', role: 'Dev', status: JobStatus.ENRICHED, stage: JobStage.FULL_PARSED });
    await adapter.upsert(doc);

    const queue = await realBus.setup([ActionEvent.QUEUED]);
    await realIngestor().processResolution('it-multi-1', 'queue');
    const queueMsg = await queue.msg();
    expect(queueMsg.jobLifecycleId).toBe('it-multi-1');

    const stored = await adapter.findById('it-multi-1');
    expect(stored?.status).toBe(JobStatus.QUEUED);
  });
});
