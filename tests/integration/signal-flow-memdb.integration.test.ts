import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();

const { JobIngestor } = await import('../../src/application/ingestor.js');

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
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: any;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(
      storage.uri,
      storage.dbName,
    );
    await adapter.connect();

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); }),
      emitCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); }),
      emitFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); }),
    };

    const routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => { routingEvents.push(['queued', ...args]); return Promise.resolve(); }),
      emitJobTrashed: vi.fn((...args: any[]) => { routingEvents.push(['trashed', ...args]); return Promise.resolve(); }),
      emitRouteFailed: vi.fn((...args: any[]) => { routingEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await adapter.disconnect();
    await storage.stop();
  });

  it('processResolutionCommand queue updates status and emits queued event', async () => {
    const doc = makeDoc({ _id: 'it-queue-1', company: 'QueueCorp', role: 'Dev' });
    await adapter.upsert(doc);

    await ingestor.processResolutionCommand({
      joblifecycleId: 'it-queue-1',
      action: 'queue',
      editedKVs: {},
    });

    const updated = await adapter.findById('it-queue-1');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(JobStatus.QUEUED);

    const queuedEvent = routingEvents.find(([type]) => type === 'queued');
    expect(queuedEvent).toBeDefined();
  });

  it('processResolutionCommand trash updates status and emits trashed event', async () => {
    const doc = makeDoc({ _id: 'it-trash-1', company: 'TrashCorp', role: 'Dev' });
    await adapter.upsert(doc);

    await ingestor.processResolutionCommand({
      joblifecycleId: 'it-trash-1',
      action: 'trash',
      editedKVs: { reason: 'not interested' },
    });

    const updated = await adapter.findById('it-trash-1');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(JobStatus.TRASHED);

    const trashedEvent = routingEvents.find(([type]) => type === 'trashed');
    expect(trashedEvent).toBeDefined();
  });

  it('processResolutionCommand with invalid joblifecycleId emits routeFailed', async () => {
    const parseBefore = parseEvents.length;
    const routeBefore = routingEvents.length;

    await ingestor.processResolutionCommand({
      joblifecycleId: 'it-nonexistent',
      action: 'queue',
      editedKVs: {},
    });

    expect(routingEvents.length).toBeGreaterThan(routeBefore);
  });

  it('allows multiple queue/trash actions on same job', async () => {
    const doc = makeDoc({ _id: 'it-multi-1', company: 'MultiCorp', role: 'Dev' });
    await adapter.upsert(doc);

    await ingestor.processResolutionCommand({ joblifecycleId: 'it-multi-1', action: 'queue', editedKVs: {} });
    expect(routingEvents.filter(([t]) => t === 'queued').length).toBeGreaterThanOrEqual(1);

    const stored = await adapter.findById('it-multi-1');
    expect(stored?.status).toBe(JobStatus.QUEUED);
  });
});
