import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

const CLIPBOARD_HTML = `<html><body>
<div class="job-detail">
  <div class="job-detail__header">
    <h1 class="job-detail__info--title">Junior Backend Developer</h1>
    <div class="job-detail__info--company">
      <span class="company-name">ClipJuniorCorp</span>
    </div>
  </div>
  <div class="job-detail__meta">
    <div class="meta-item section-salary">
      <span class="label">Salary:</span>
      <span class="job-detail__info--section-content-value">12,000,000 VNĐ</span>
    </div>
    <div class="meta-item section-location">
      <span class="label">Location:</span>
      <span class="job-detail__info--section-content-value">Ho Chi Minh City</span>
    </div>
    <div class="meta-item">
      <span class="label">Deadline:</span>
      <span class="value">Còn 30 ngày để ứng tuyển</span>
    </div>
  </div>
  <div class="section section-description">
    <h3>Mô tả công việc</h3>
    <div class="job-description__item--content">
      <p>We are looking for a Junior Backend Developer with TypeScript experience.</p>
      <strong>Requirements:</strong>
      <ul>
        <li>TypeScript and Node.js</li>
        <li>Database knowledge</li>
      </ul>
      <strong>Benefits:</strong>
      <ul>
        <li>Competitive salary</li>
        <li>Health insurance</li>
      </ul>
    </div>
  </div>
  <div class="section section-company">
    <h2>About Company</h2>
    <div class="company-info">
      <p><strong>Company Name:</strong> ClipJuniorCorp</p>
    </div>
  </div>
</div>
</body></html>`;

const CLIPBOARD_HTML_2B = CLIPBOARD_HTML.replace(/ClipJuniorCorp/g, 'CopyJuniorCorp');

const EMPTY_HTML = '';

describe('E2E2: Direct Mode (Signal 2a manual + Signal 2b clipboard)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

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
      emitJobGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitJobGeneratedFailed: vi.fn((...args: any[]) => { parseEvents.push(['generatedFailed', ...args]); return Promise.resolve(); }),
      emitParseCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitParseFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
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

  it('Signal 2a upgrades PARTIAL_PARSED to FULL_PARSED with merged fields', async () => {
    const joblifecycleId = 'e2e-2a-1';
    const partialDoc = {
      _id: joblifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'OldCorp',
      role: 'Junior Backend Developer',
      url: 'https://example.com/job',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML,
      joblifecycleId,
      receivedAt: new Date(),
    });

    const fullDoc = await adapter.findById(joblifecycleId);
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
    expect(fullDoc!.company).toBe('ClipJuniorCorp');
    expect(fullDoc!.role).toBe('Junior Backend Developer');
    expect(fullDoc!.salary).toBe('12,000,000 VNĐ');
    expect(fullDoc!.location).toBe('Ho Chi Minh City');
    expect(fullDoc!.matchScore).toBeGreaterThan(0);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore + 1);
  });

  it('Signal 2a with empty payload fails gracefully', async () => {
    const joblifecycleId = 'e2e-2a-empty';
    const partialDoc = {
      _id: joblifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'FailCorp',
      role: 'Junior Dev',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: EMPTY_HTML,
      joblifecycleId,
      receivedAt: new Date(),
    });

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(failedBefore + 1);

    const doc = await adapter.findById(joblifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.FAILED);
  });

  it('Signal 2b creates new FULL_PARSED job with clip-* ID', async () => {
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;
    const docsBefore = await (adapter as any).jobLifecycleCollection.countDocuments({});

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML_2B,
      receivedAt: new Date(),
    });

    const docsAfter = await (adapter as any).jobLifecycleCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);

    const col = (adapter as any).jobLifecycleCollection;
    const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const newDoc = docs[0];
    expect(newDoc._id).toMatch(/^clip-/);
    expect(newDoc.stage).toBe(JobStage.FULL_PARSED);
    expect(newDoc.status).toBe(JobStatus.ENRICHED);
    expect(newDoc.company).toBe('CopyJuniorCorp');
    expect(newDoc.role).toBe('Junior Backend Developer');
    expect(newDoc.matchScore).toBeGreaterThan(0);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore + 1);
  });

  it('Signal 2b duplicate role+company silently skips', async () => {
    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML_2B,
      receivedAt: new Date(),
    });

    const docsBefore = await (adapter as any).jobLifecycleCollection.countDocuments({});
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngestCommand({
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      rawPayload: CLIPBOARD_HTML_2B,
      receivedAt: new Date(),
    });

    const docsAfter = await (adapter as any).jobLifecycleCollection.countDocuments({});
    expect(docsAfter).toBe(docsBefore);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore);
  });
});
