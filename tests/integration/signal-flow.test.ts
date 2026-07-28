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

function emailHtmlFor(role: string, company: string): string {
  const encodedUrl = `/viec-lam/${role.toLowerCase().replace(/\s+/g, '-')}`;
  return `<html><body>
    <a class="job-item-link" href="${encodedUrl}">
      <div class="topcv-job-item">
        <div class="title"><span>${role}</span></div>
        <div class="company"><span>${company}</span></div>
        <div>Hà Nội</div>
      </div>
    </a>
    <p>topcv job-item</p>
    <p>TypeScript</p>
  </body></html>`;
}

function detailHtmlFor(role: string, company: string): string {
  return `<div class="job-detail__info--title"><h1>${role}</h1></div>`
    + `<div class="company-name-label"><a class="name">${company}</a></div>`
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">We need a TypeScript developer with JavaScript skills</div>'
    + '</div>';
}

describeIf('Signal Flow Integration', { timeout: 30000 }, () => {
  let client: MongoClient;
  let adapter: MongoJobLifecycleAdapter;
  let parseEventPort: ReturnType<typeof createParseEventPort>;
  let routingPort: ReturnType<typeof createRoutingPort>;
  let ingestor: JobIngestor;

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
    adapter = new MongoJobLifecycleAdapter(client.db(DB_NAME));
  });

  afterAll(async () => {
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
    const html = emailHtmlFor('Software Engineer', 'TestCo A');

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'int-s1' });

    expect(parseEventPort.emitGenerated).toHaveBeenCalled();
    const canonicalJob = parseEventPort.emitGenerated.mock.calls[0][0];
    const id = canonicalJob._id;
    expect(id).toBeTruthy();

    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHING);
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('S1→S2: job.generated then job.parse.completed', async () => {
    const html = emailHtmlFor('Software Engineer', 'TestCo B');

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, html, undefined, { messageId: 'int-s1s2' });

    expect(parseEventPort.emitGenerated).toHaveBeenCalled();
    const canonicalJob = parseEventPort.emitGenerated.mock.calls[0][0];
    const id = canonicalJob._id;

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, detailHtmlFor('Software Engineer', 'TestCo B'), id);

    expect(parseEventPort.emitCompleted).toHaveBeenCalledTimes(1);
    const emitArgs = parseEventPort.emitCompleted.mock.calls[0];
    expect(emitArgs[0]._id).toBe(id);
    expect(emitArgs[1]).toEqual(expect.objectContaining({ stage: JobStage.FULL_PARSED }));

    const doc = await adapter.findById(id);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
  });

  it('S1→S3: job.generated then operator queues', async () => {
    const html = detailHtmlFor('Junior Engineer C', 'TestCo C');

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);

    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
    const jobLifecycleId = parseEventPort.emitCompleted.mock.calls[0][0]._id;

    await ingestor.processResolution(jobLifecycleId, 'queue');

    expect(routingPort.emitJobQueued).toHaveBeenCalled();
    const doc = await adapter.findById(jobLifecycleId);
    expect(doc?.status).toBe(JobStatus.QUEUED);
  });

  it('S1→S3: job.generated then operator trashes', async () => {
    const html = detailHtmlFor('Junior Engineer D', 'TestCo D');

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);

    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
    const jobLifecycleId = parseEventPort.emitCompleted.mock.calls[0][0]._id;

    await ingestor.processResolution(jobLifecycleId, 'trash');

    expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    const doc = await adapter.findById(jobLifecycleId);
    expect(doc?.status).toBe(JobStatus.TRASHED);
  });

  it('S4: invalid action silently handled (no routing event emitted)', async () => {
    const html = detailHtmlFor('Junior Engineer E', 'TestCo E');

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html);

    expect(parseEventPort.emitCompleted).toHaveBeenCalled();
    const jobLifecycleId = parseEventPort.emitCompleted.mock.calls[0][0]._id;

    await expect(
      ingestor.processResolution(jobLifecycleId, 'invalid' as any)
    ).resolves.toBeUndefined();

    // Invalid action is silently handled (no routing event)
    expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    expect(routingPort.emitJobTrashed).not.toHaveBeenCalled();
    expect(routingPort.emitRouteFailed).not.toHaveBeenCalled();
  });
});
