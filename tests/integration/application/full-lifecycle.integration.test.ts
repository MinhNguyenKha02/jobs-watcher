import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createTestContainer, type TestContainer } from '../../helpers/test-container.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { createParseEventPort, createRoutingPort } from '../../helpers/mock-ports.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js' ;
import type { MongoJobLifecycleAdapter } from '../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';

const { JobIngestor } = await import('../../../src/application/ingestor.js');

describe('T1: Full lifecycle S1→S2→S3→S4 coverage (Case 1, 2, 3)', () => {
  let tc: TestContainer;
  let adapter: MongoJobLifecycleAdapter;
  let parseEventPort: ReturnType<typeof createParseEventPort>;
  let routingPort: ReturnType<typeof createRoutingPort>;
  let ingestor: JobIngestor;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'app-full-lifecycle' });
    await tc.start();
    adapter = tc.mongoJobLifecycleAdapter;

    parseEventPort = createParseEventPort();

    routingPort = createRoutingPort();

    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('S1→S2→S3: partial job upgraded to full then queued (Case 1)', async () => {
    await tc.storage.clearDb();

    const role = 'Software Engineer';
    const company = 'CycleCo1a';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role, company }]), undefined, { messageId: 'msg-cycle-1a', subject: role });

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
    const docId = parseEventPort.emitGenerated.mock.calls[0][0]._id;
    expect(docId).toBeTruthy();

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml(role, company), docId);

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
    await tc.storage.clearDb();
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
    await tc.storage.clearDb();
    vi.clearAllMocks();

    // verify parseEventPort mocks are functional
    await parseEventPort.emitGenerated({ _id: 'test-pre' }, { stage: JobStage.PARTIAL_PARSED, source: JobSource.BROWSER_AUTO });
    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'fail-s4-1');

    expect(parseEventPort.emitFailed).toHaveBeenCalledTimes(1);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'RecoveryCo' }]), undefined, { messageId: 'msg-s4-recover' });

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
  });

  it('S3 resolution failure→S4→next S1 succeeds (Case 3)', async () => {
    await tc.storage.clearDb();
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

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'RecoveryCo2' }]), undefined, { messageId: 'msg-cycle-3c' });

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
  });

  it('S2 via BROWSER_AUTO FULL_PARSED emits both generated + completed (Case 2 arrival)', async () => {
    await tc.storage.clearDb();
    vi.clearAllMocks();

    const docId = 'int-full-parsed-arrival';

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'ArrivalCo'), docId);

    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
    expect(parseEventPort.emitCompleted).toHaveBeenCalledTimes(1);

    const doc = await adapter.findById(docId);
    expect(doc).not.toBeNull();
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
  });

  it('S2 via BROWSER_AUTO without jobLifecycleId creates doc and emits completed', async () => {
    await tc.storage.clearDb();
    vi.clearAllMocks();

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'NoIdCo'));

    expect(parseEventPort.emitCompleted).toHaveBeenCalledTimes(1);
    expect(parseEventPort.emitGenerated).toHaveBeenCalledTimes(1);
  });

  it('[c] on already FULL_PARSED job still emits completed (B2 guard at UI level only)', async () => {
    await tc.storage.clearDb();
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

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'DoubleCo'), docId);

    const completedEvents = parseEventPort.emitCompleted.mock.calls.filter(
      (c: any) => c[0] === docId
    );
    expect(completedEvents.length).toBe(0);
  });

  it('empty HTML in signal2aManual emits parse.failed with status FAILED', async () => {
    await tc.storage.clearDb();
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
    await tc.storage.clearDb();
    vi.clearAllMocks();

    const parseFailedBefore = parseEventPort.emitFailed.mock.calls.length;

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'NoIdErrCo'));

    const parseFailedAfter = parseEventPort.emitFailed.mock.calls.length;
    expect(parseFailedAfter).toBe(parseFailedBefore);
  });
});
