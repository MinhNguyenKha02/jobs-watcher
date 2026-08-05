import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { createRealDipBus, type RealDipBus } from '../../../helpers/real-dip-bus.js';
import { linkedinSduiDetailHtml } from '../../../helpers/html-fixtures.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../../src/domain/types/job-lifecycle.js' ;
import { ActionEvent } from '../../../../src/domain/types/action-event.js';

describe('Ingestor Signal Flow Integration', { timeout: 30000 }, () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let parseEventPort: ReturnType<typeof createParseEventPort>;
  let routingPort: ReturnType<typeof createRoutingPort>;
  let ingestor: JobIngestor;
  let realIngestor: () => JobIngestor;
  let realBus: RealDipBus;

  function createParseEventPort() {
    return {
      emitGenerated: vi.fn(),
      emitCompleted: vi.fn(),
      emitFailed: vi.fn(),
    };
  }

  function createRoutingPort() {
    return {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };
  }

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    realBus = await createRealDipBus('jobs.events.int.c4.signal-flow');
    realIngestor = () => new JobIngestor(adapter, realBus.parsePort, realBus.routePort);
  });

  afterAll(async () => {
    await realBus.teardown();
    await storage.stop();
  });

  beforeEach(async () => {
    await storage.client.db(storage.dbName).dropDatabase();
    parseEventPort = createParseEventPort();
    routingPort = createRoutingPort();
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  it('S2b: signal2bManual creates job with clip-* ID and FULL_PARSED status — real-DIP', async () => {
    const html = linkedinSduiDetailHtml('Software Engineer', 'Clipboard Co');
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await realIngestor().processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    const compMsg = await comp.msg();
    const id = compMsg.job._id;
    expect(id).toMatch(/^clip-/);
    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.source).toBe(JobSource.MANUAL);
  });

it('S2b: signal2bManual stores correct source and stage in MongoDB — real-DIP', async () => {
    const html = linkedinSduiDetailHtml('Software Engineer', 'Direct Co');
    const comp = await realBus.setup([ActionEvent.PARSE_COMPLETED]);
    await realIngestor().processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);
    const compMsg = await comp.msg();
    const id = compMsg.job._id;
    const doc = await adapter.findById(id);
    expect(doc!.source).toBe(JobSource.MANUAL);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.company).toBe('Direct Co');
    expect(doc!.role).toBe('Software Engineer');
  });

  it('S2a: emits parse.failed on empty HTML payload — real-DIP', async () => {
    const fail = await realBus.setup([ActionEvent.PARSE_FAILED]);
    await realIngestor().processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'test-empty-id');
    const failMsg = await fail.msg();
    expect(failMsg.jobLifecycleId).toBe('test-empty-id');
  });

  it('propagates non-11000 upsert error', async () => {
    const badDb = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    vi.spyOn(badDb, 'upsert').mockRejectedValueOnce(
      Object.assign(new Error('Disk full'), { code: 9000 })
    );
    const standalone = new JobIngestor(badDb, parseEventPort, routingPort);

    await expect(
      standalone.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, linkedinSduiDetailHtml('Software Engineer', 'FailCo'))
    ).rejects.toThrow('Disk full');
  });
});
