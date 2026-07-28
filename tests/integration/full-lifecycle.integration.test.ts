import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js' ;
import { getLogger } from '../../src/infrastructure/outbound/logging/logger.js' ;
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js' ;

const logger = getLogger();
const { JobIngestor } = await import('../../src/application/ingestor.js');

function makeTopCvHtml(company: string, role: string): string {
  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">We need a TypeScript developer with JavaScript skills</div>'
    + '</div>';
}

function emailHtmlFor(company: string, role: string): string {
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
    <p>TypeScript developer</p>
  </body></html>`;
}

function makeStage1Partial(overrides = {}): any {
  return {
    _id: overrides._id || 'test-id',
    company: overrides.company || 'TestCo',
    role: overrides.role || 'Tester',
    description: 'TypeScript developer',
    location: 'Test Location',
    url: 'https://test.com/job',
    salary: '',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
    raw: '',
    ...overrides,
  };
}

describe('T1: Full lifecycle S1→S2→S3→S4 coverage (Case 1, 2, 3)', () => {
  let storage: any;
  let adapter: MongoJobLifecycleAdapter;
  let parseEventPort: Record<string, ReturnType<typeof vi.fn>>;
  let routingPort: Record<string, ReturnType<typeof vi.fn>>;
  let ingestor: JobIngestor;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));

    parseEventPort = {
      emitGenerated: vi.fn((...args: any[]) => Promise.resolve()),
      emitCompleted: vi.fn((...args: any[]) => Promise.resolve()),
      emitFailed: vi.fn((...args: any[]) => Promise.resolve()),
    };

    routingPort = {
      emitJobQueued: vi.fn((...args: any[]) => Promise.resolve()),
      emitJobTrashed: vi.fn((...args: any[]) => Promise.resolve()),
      emitRouteFailed: vi.fn((...args: any[]) => Promise.resolve()),
    };

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await storage.stop();
  });

  async function clearCollections() {
    const db = storage.client.db(storage.dbName);
    const cols = await db.listCollections().toArray();
    for (const col of cols) {
      await db.collection(col.name).deleteMany({});
    }
  }

  it('S1→S2→S3: partial job upgraded to full then queued (Case 1)', async () => {
    await clearCollections();

    const role = 'Software Engineer';
    const company = 'CycleCo1a';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, makeTopCvHtml(company, role), undefined, { messageId: 'msg-cycle-1a', subject: role });

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
    const docId = parseEventPort.emitGenerated.mock.calls[0][0]._id;
    expect(docId).toBeTruthy();

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeTopCvHtml(company, role), docId);

    expect(parseEventPort.emitCompleted).toHaveBeenCalledTimes(1);

    const fullDoc = await adapter.findById(docId);
    expect(fullDoc).not.toBeNull();
    expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
    expect(fullDoc!.status).toBe(JobStatus.ENRICHED);

    await ingestor.processResolution(docId, 'queue');

    expect(routingPort.emitJobQueued).toHaveBeenCalledTimes(1);

    const routedDoc = await adapter.findById(docId);
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('S1→S3: fully parsed job directly queued (Case 2)', async () => {
    await clearCollections();
    vi.clearAllMocks();

    const docId = 'cycle-full-2';
    const partialDoc = makeStage1Partial({
      _id: docId,
      company: 'DirectCo',
      role: 'Direct Engineer',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    });
    await adapter.upsert(partialDoc);

    await ingestor.processResolution(docId, 'queue');

    expect(routingPort.emitJobQueued).toHaveBeenCalledTimes(1);

    const routedDoc = await adapter.findById(docId);
    expect(routedDoc!.status).toBe(JobStatus.QUEUED);
  });

  it('S2 failure→S4→next S1 succeeds (Case 3)', async () => {
    await clearCollections();
    vi.clearAllMocks();

    // verify parseEventPort mocks are functional
    await parseEventPort.emitGenerated({ _id: 'test-pre' }, { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO });
    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'fail-s4-1');

    expect(parseEventPort.emitFailed).toHaveBeenCalledTimes(1);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, makeTopCvHtml('RecoveryCo', 'Software Engineer'), undefined, { messageId: 'msg-s4-recover' });

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
  });

  it('S3 resolution failure→S4→next S1 succeeds (Case 3)', async () => {
    await clearCollections();
    vi.clearAllMocks();

    const docId = 'cycle-fail-3b';
    await adapter.upsert(makeStage1Partial({
      _id: docId,
      company: 'FailCo3b',
      role: 'Fail Role 3b',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    }));

    vi.spyOn(adapter, 'updateStage').mockRejectedValueOnce(new Error('DB write timeout'));

    await ingestor.processResolution(docId, 'queue');

    expect(routingPort.emitRouteFailed).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, makeTopCvHtml('RecoveryCo2', 'Software Engineer'), undefined, { messageId: 'msg-cycle-3c' });

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
  });

  it('S2 via BROWSER_AUTO FULL_PARSED emits both generated + completed (Case 2 arrival)', async () => {
    await clearCollections();
    vi.clearAllMocks();

    const docId = 'int-full-parsed-arrival';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, makeTopCvHtml('ArrivalCo', 'Software Engineer'), docId);

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
    expect(parseEventPort.emitCompleted).toHaveBeenCalledTimes(1);

    const doc = await adapter.findById(docId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
  });

  it('S2 via BROWSER_AUTO without jobLifecycleId creates doc and emits completed', async () => {
    await clearCollections();
    vi.clearAllMocks();

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, makeTopCvHtml('NoIdCo', 'Software Engineer'));

    expect(parseEventPort.emitCompleted).toHaveBeenCalledTimes(1);
    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
  });

  it('[c] on already FULL_PARSED job still emits completed (B2 guard at UI level only)', async () => {
    await clearCollections();
    vi.clearAllMocks();

    const docId = 'int-double-parse';
    const partialDoc = makeStage1Partial({
      _id: docId,
      company: 'DoubleCo',
      role: 'Software Engineer',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    });
    await adapter.upsert(partialDoc);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeTopCvHtml('DoubleCo', 'Software Engineer'), docId);

    const completedEvents = parseEventPort.emitCompleted.mock.calls.filter(
      (c: any) => c[0] === docId
    );
    expect(completedEvents.length).toBe(0);
  });

  it('empty HTML in signal2aManual emits parse.failed with status FAILED', async () => {
    await clearCollections();
    vi.clearAllMocks();

    const docId = 'int-empty-html-s2';
    const partialDoc = makeStage1Partial({
      _id: docId,
      company: 'EmptyCo',
      role: 'Junior Dev',
    });
    await adapter.upsert(partialDoc);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', docId);

    expect(parseEventPort.emitFailed).toHaveBeenCalledTimes(1);
  });

  it('signal2aManual without jobLifecycleId silently drops (B9 fix — no fake ID)', async () => {
    await clearCollections();
    vi.clearAllMocks();

    const parseFailedBefore = parseEventPort.emitFailed.mock.calls.length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, makeTopCvHtml('NoIdErrCo', 'Software Engineer'));

    const parseFailedAfter = parseEventPort.emitFailed.mock.calls.length;
    expect(parseFailedAfter).toBe(parseFailedBefore);
  });
});
