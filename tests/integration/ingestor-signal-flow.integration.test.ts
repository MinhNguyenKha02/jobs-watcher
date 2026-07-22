import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoDBStorageAdapter } from '../../src/infrastructure/outbound/persistence/mongodb-storage-adapter.js' ;
import JobIngestor from '../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../src/domain/types/job-lifecycle.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const runReal = process.env.SIGNAL_FLOW_INTEGRATION === 'true' || MONGODB_URI !== 'mongodb://localhost:27017';
const describeIf = runReal ? describe : describe.skip;

const logger = getLogger();
const DB_NAME = 'ingestor-signal-flow-integration-test';

function htmlFor(role: string, company: string): string {
  return `<div class="job-detail__info--title"><h1>${role}</h1></div>`
    + `<div class="company-name-label"><a class="name">${company}</a></div>`
    + '<div>topcv</div>';
}

describeIf('Ingestor Signal Flow Integration', { timeout: 30000 }, () => {
  let client: MongoClient;
  let adapter: MongoDBStorageAdapter;
  let parseEventPort: ReturnType<typeof createParseEventPort>;
  let routingPort: ReturnType<typeof createRoutingPort>;
  let ingestor: JobIngestor;

  function createParseEventPort() {
    return {
      emitJobGenerated: vi.fn(),
      emitParseCompleted: vi.fn(),
      emitParseFailed: vi.fn(),
      emitJobGeneratedFailed: vi.fn(),
    };
  }

  function createRoutingPort() {
    return {
      emitJobQueued: vi.fn(),
      emitJobTrashed: vi.fn(),
      emitRouteFailed: vi.fn(),
    };
  }

  async function cleanDb() {
    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();
    for (const c of collections) {
      await db.collection(c.name).deleteMany({});
    }
  }

  beforeAll(async () => {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    await client.db(DB_NAME).dropDatabase();
    adapter = new MongoDBStorageAdapter({ mongoUri: MONGODB_URI, dbName: DB_NAME, logger });
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
    await client.db(DB_NAME).dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    await cleanDb();
    parseEventPort = createParseEventPort();
    routingPort = createRoutingPort();
    ingestor = new JobIngestor(adapter, { parseEventPort, routingPort });
  });

  it('S2b: signal2bManual creates job with clip-* ID and FULL_PARSED status', async () => {
    const html = htmlFor('Junior Engineer', 'Clipboard Co');
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: html,
    });
    expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    const id = parseEventPort.emitParseCompleted.mock.calls[0][0];
    expect(id).toMatch(/^clip-/);
    const doc = await adapter.findJobLifecycleById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.source).toBe(JobSource.MANUAL);
  });

  it('S1→S2: chained enrich preserves and merges fields from partial to full', async () => {
    const partialHtml = htmlFor('Junior Engineer', 'Chained Co');
    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: partialHtml,
      metadata: { messageId: 'chain-msg' },
    });
    expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    const s1Job = parseEventPort.emitJobGenerated.mock.calls[0][0];
    const joblifecycleId = s1Job._id;
    const s1Doc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(s1Doc).not.toBeNull();
    expect(s1Doc!.stage).toBe(JobStage.PARTIAL_PARSED);

    const fullHtml = htmlFor('Senior Engineer', 'Chained Co');
    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.FULL_PARSED,
      rawPayload: fullHtml,
      joblifecycleId,
    });
    expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    const s2Doc = await adapter.findJobLifecycleById(joblifecycleId);
    expect(s2Doc).not.toBeNull();
    expect(s2Doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(s2Doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('S2b: signal2bManual stores correct source and stage in MongoDB', async () => {
    const html = htmlFor('Junior Engineer', 'Direct Co');
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: html,
    });
    expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    const id = parseEventPort.emitParseCompleted.mock.calls[0][0];
    const doc = await adapter.findJobLifecycleById(id);
    expect(doc!.source).toBe(JobSource.MANUAL);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.company).toBe('Direct Co');
    expect(doc!.role).toBe('Junior Engineer');
    expect(doc!.matchScore).toBeGreaterThanOrEqual(0);
  });

  it('S2a: emits parse.failed on empty HTML payload', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: '',
      joblifecycleId: 'test-empty-id',
    });
    expect(parseEventPort.emitParseFailed).toHaveBeenCalledWith(
      'test-empty-id',
      expect.objectContaining({ error: 'Empty HTML payload' })
    );
  });

  it('propagates non-11000 upsert error', async () => {
    const badDb = new MongoDBStorageAdapter({ mongoUri: MONGODB_URI, dbName: DB_NAME, logger });
    await badDb.connect();
    vi.spyOn(badDb, 'upsertJobLifecycle').mockRejectedValueOnce(
      Object.assign(new Error('Disk full'), { code: 9000 })
    );
    const standalone = new JobIngestor(badDb, { parseEventPort, routingPort });

    await expect(
      standalone.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: htmlFor('Junior Engineer', 'FailCo'),
      })
    ).rejects.toThrow('Disk full');
    await badDb.disconnect();
  });
});
