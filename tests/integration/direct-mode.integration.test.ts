import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';

const { JobIngestor } = await import('../../src/application/ingestor.js');

const CLIPBOARD_HTML = `<html><body>
<div class="job-detail">
  <div class="job-detail__header">
    <h1 class="job-detail__info--title">Backend Developer</h1>
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
  </div>
  <div class="section section-description">
    <h3>Mô tả công việc</h3>
    <div class="job-description__item--content">
      <p>We are looking for a Backend Developer with TypeScript experience.</p>
      <strong>Requirements:</strong>
      <ul>
        <li>TypeScript and Node.js</li>
      </ul>
    </div>
  </div>
</div>
</body></html>`;

const CLIPBOARD_HTML_2B = CLIPBOARD_HTML.replace(/ClipJuniorCorp/g, 'CopyJuniorCorp');

const EMPTY_HTML = '';

describe('Direct Mode (Signal 2a manual + Signal 2b clipboard)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEvents: any[];
  let routingEvents: any[];
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(
      storage.client.db(storage.dbName),
    );

    parseEvents = [];
    routingEvents = [];

    const parseEventPort = {
      emitGenerated: vi.fn((...args: any[]) => { parseEvents.push(['generated', ...args]); return Promise.resolve(); }),
      emitCompleted: vi.fn((...args: any[]) => { parseEvents.push(['completed', ...args]); return Promise.resolve(); }),
      emitFailed: vi.fn((...args: any[]) => { parseEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    const routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => { routingEvents.push(['queued', ...args]); return Promise.resolve(); }),
      emitJobTrashed: vi.fn((...args: any[]) => { routingEvents.push(['trashed', ...args]); return Promise.resolve(); }),
      emitRouteFailed: vi.fn((...args: any[]) => { routingEvents.push(['failed', ...args]); return Promise.resolve(); }),
    };

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await storage.stop();
  });

  it('Signal 2a upgrades PARTIAL_PARSED to FULL_PARSED with merged fields', async () => {
    const jobLifecycleId = 'e2e-2a-1';
    const partialDoc = {
      _id: jobLifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'OldCorp',
      role: 'Backend Developer',
      url: 'https://example.com/job',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId, undefined, new Date());

    const fullDoc = await adapter.findById(jobLifecycleId);
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
    expect(fullDoc!.company).toBe('ClipJuniorCorp');
    expect(fullDoc!.role).toBe('Backend Developer');
    expect(fullDoc!.salary).toBe('12,000,000 VNĐ');
    expect(fullDoc!.location).toBe('Ho Chi Minh City');

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore + 1);
  });

  it('Signal 2a with empty payload fails gracefully', async () => {
    const jobLifecycleId = 'e2e-2a-empty';
    const partialDoc = {
      _id: jobLifecycleId,
      raw: '<html><body>partial</body></html>',
      stage: JobStage.PARTIAL_PARSED,
      status: JobStatus.ENRICHING,
      source: JobSource.BROWSER_AUTO,
      company: 'FailCorp',
      role: 'Backend Developer',
      createdAt: new Date(),
      updatedAt: new Date(),
      stageTimestamp: new Date(),
    };
    await adapter.upsert(partialDoc as any);

    const failedBefore = parseEvents.filter(([t]) => t === 'failed').length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, EMPTY_HTML, jobLifecycleId, undefined, new Date());

    const failedEvents = parseEvents.filter(([t]) => t === 'failed');
    expect(failedEvents.length).toBe(failedBefore + 1);

    const doc = await adapter.findById(jobLifecycleId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('Signal 2b creates new FULL_PARSED job with clip-* ID', async () => {
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;
    const col = storage.client.db(storage.dbName).collection('job_lifecycle');
    const docsBefore = await col.countDocuments({});

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML_2B, undefined, undefined, new Date());

    const docsAfter = await col.countDocuments({});
    expect(docsAfter).toBe(docsBefore + 1);

    const docs = await col.find({}).sort({ createdAt: -1 }).limit(1).toArray();
    const newDoc = docs[0];
    expect(newDoc._id).toMatch(/^clip-/);
    expect(newDoc.stage).toBe(JobStage.FULL_PARSED);
    expect(newDoc.status).toBe(JobStatus.ENRICHED);
    expect(newDoc.company).toBe('CopyJuniorCorp');
    expect(newDoc.role).toBe('Backend Developer');

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore + 1);
  });

  it('Signal 2b duplicate role+company silently skips', async () => {
    const col = storage.client.db(storage.dbName).collection('job_lifecycle');
    await col.deleteMany({});

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML_2B, undefined, undefined, new Date());

    const docsBefore = await col.countDocuments({});
    const completedBefore = parseEvents.filter(([t]) => t === 'completed').length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML_2B, undefined, undefined, new Date());

    const docsAfter = await col.countDocuments({});
    expect(docsAfter).toBe(docsBefore);

    const completedEvents = parseEvents.filter(([t]) => t === 'completed');
    expect(completedEvents.length).toBe(completedBefore);
  });
});
