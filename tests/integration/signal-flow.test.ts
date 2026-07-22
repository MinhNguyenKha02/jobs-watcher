import 'dotenv/config';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { JobIngestor } from '../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../src/domain/types/job-lifecycle.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const runReal = process.env.SIGNAL_FLOW_INTEGRATION === 'true' || MONGODB_URI !== 'mongodb://localhost:27017';
const describeIf = runReal ? describe : describe.skip;

const logger = getLogger();
const DB_NAME = 'signal-flow-integration-test';

function htmlFor(role: string, company: string): string {
  return `<div class="job-detail__info--title"><h1>${role}</h1></div>`
    + `<div class="company-name-label"><a class="name">${company}</a></div>`
    + '<div>topcv</div>';
}

describeIf('Signal Flow Integration', { timeout: 30000 }, () => {
  let client: MongoClient;
  let adapter: MongoJobLifecycleAdapter;
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
    adapter = new MongoJobLifecycleAdapter(MONGODB_URI, DB_NAME);
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
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  it('S1: job.generated for BROWSER_AUTO PARTIAL_PARSED', async () => {
    const html = htmlFor('Junior Engineer A', 'TestCo A');

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: html,
      metadata: { messageId: 'int-s1' },
    });

    expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    const canonicalJob = parseEventPort.emitJobGenerated.mock.calls[0][0];
    const id = canonicalJob._id;
    expect(id).toBeTruthy();

    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('S1→S2: job.generated then job.parse.completed', async () => {
    const html = htmlFor('Junior Engineer B', 'TestCo B');

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.PARTIAL_PARSED,
      rawPayload: html,
      metadata: { messageId: 'int-s1s2' },
    });

    expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    const canonicalJob = parseEventPort.emitJobGenerated.mock.calls[0][0];
    const id = canonicalJob._id;

    await ingestor.processIngestCommand({
      source: JobSource.BROWSER_AUTO,
      stage: JobStage.FULL_PARSED,
      rawPayload: html,
      joblifecycleId: id,
    });

    expect(parseEventPort.emitParseCompleted).toHaveBeenCalledTimes(1);
    const emitArgs = parseEventPort.emitParseCompleted.mock.calls[0];
    expect(emitArgs[0]).toBe(id);
    expect(emitArgs[1]).toBeTruthy();
    expect(emitArgs[2]).toEqual(expect.objectContaining({ stage: JobStage.FULL_PARSED }));

    const doc = await adapter.findById(id);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
  });

  it('S1→S3: job.generated then operator queues', async () => {
    const html = htmlFor('Junior Engineer C', 'TestCo C');

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: html,
    });

    expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    const joblifecycleId = parseEventPort.emitParseCompleted.mock.calls[0][0];

    await ingestor.processResolutionCommand({ joblifecycleId, action: 'queue' });

    expect(routingPort.emitJobQueued).toHaveBeenCalled();
    const doc = await adapter.findById(joblifecycleId);
    expect(doc?.status).toBe(JobStatus.QUEUED);
  });

  it('S1→S3: job.generated then operator trashes', async () => {
    const html = htmlFor('Junior Engineer D', 'TestCo D');

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: html,
    });

    expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    const joblifecycleId = parseEventPort.emitParseCompleted.mock.calls[0][0];

    await ingestor.processResolutionCommand({ joblifecycleId, action: 'trash' });

    expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    const doc = await adapter.findById(joblifecycleId);
    expect(doc?.status).toBe(JobStatus.TRASHED);
  });

  it('S4: invalid action silently handled (no routing event emitted)', async () => {
    const html = htmlFor('Junior Engineer E', 'TestCo E');

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: html,
    });

    expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    const joblifecycleId = parseEventPort.emitParseCompleted.mock.calls[0][0];

    await expect(
      ingestor.processResolutionCommand({ joblifecycleId, action: 'invalid' as any })
    ).resolves.toBeUndefined();

    // Should not emit any routing event for unknown action
    expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    expect(routingPort.emitJobTrashed).not.toHaveBeenCalled();
    expect(routingPort.emitRouteFailed).not.toHaveBeenCalled();
  });
});
