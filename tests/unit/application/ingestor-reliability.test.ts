import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js' ;

vi.mock('../../../src/filter/job-filter.js', () => ({
  hybridJobFilter: vi.fn(() => { throw new Error('Filter engine unavailable'); }),
}));

const { default: JobIngestor } = await import('../../../src/application/ingestor.js');

function createMockStorage() {
  return {
    upsertJobLifecycle: vi.fn(),
    updateJobStatus: vi.fn(),
    findJobLifecycleById: vi.fn(),
    insertActionSnapshot: vi.fn(),
    findJobByRoleCompany: vi.fn(),
    extractionQueue: { enqueue: vi.fn() },
  };
}

function createMockParseEventPort() {
  return {
    emitJobGenerated: vi.fn(),
    emitParseCompleted: vi.fn(),
    emitParseFailed: vi.fn(),
    emitJobGeneratedFailed: vi.fn(),
  };
}

function createMockRoutingPort() {
  return {
    emitJobQueued: vi.fn(),
    emitJobTrashed: vi.fn(),
    emitRouteFailed: vi.fn(),
  };
}

function makeTopCvHtml(): string {
  return '<div class="job-detail__info--title"><h1>Junior Engineer</h1></div>'
    + '<div class="company-name-label"><a class="name">Junior Co</a></div>'
    + '<div>topcv</div>';
}

function makeStage1Partial(overrides = {}): any {
  return {
    _id: 'test-id',
    company: 'Test Co',
    role: 'Junior Engineer',
    description: 'TypeScript developer role',
    location: 'Test Location',
    url: 'https://test.com/job',
    salary: '$100k',
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

describe('Ingestor reliability edges', () => {
  let ingestor: JobIngestor;
  let storage: ReturnType<typeof createMockStorage>;
  let parseEventPort: ReturnType<typeof createMockParseEventPort>;
  let routingPort: ReturnType<typeof createMockRoutingPort>;

  beforeEach(() => {
    storage = createMockStorage();
    parseEventPort = createMockParseEventPort();
    routingPort = createMockRoutingPort();
    ingestor = new JobIngestor(storage, { parseEventPort, routingPort });
  });

  describe('hybridJobFilter exception swallowing', () => {
    it('passes job through when underlying filter throws', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'msg-filter-throw' },
      });

      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });

    it('filter does not block s2 clip processing when filter throws', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
      });

      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });
  });

  describe('signal2cBrowserAuto null stage1Partial', () => {
    it('processes BROWSER_AUTO FULL_PARSED when stage1 doc is missing', async () => {
      storage.findJobLifecycleById.mockResolvedValue(null);

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'browser-null-s1',
      });

      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
    });

    it('emits parse.failed when HTML parse fails after null stage1', async () => {
      storage.findJobLifecycleById.mockResolvedValue(null);

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.FULL_PARSED,
        rawPayload: '<html>no job data</html>',
        joblifecycleId: 'browser-parse-fail',
      });

      expect(parseEventPort.emitParseFailed).toHaveBeenCalled();
      expect(storage.updateJobStatus).toHaveBeenCalled();
    });
  });

  describe('failure cycle — S4 then next S1 succeeds', () => {
    it('after s4 parse.failed, a new S1 job still processes normally', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: '',
        joblifecycleId: 's4-fail-job',
      });

      expect(parseEventPort.emitParseFailed).toHaveBeenCalled();

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 's1-after-s4' },
      });

      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
    });

    it('after s4 route.failed, a new S1 job still processes normally', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({ _id: 's4b-job' }));
      storage.updateJobStatus.mockRejectedValue(new Error('DB error'));

      await ingestor.processResolutionCommand({
        joblifecycleId: 's4b-job',
        action: 'queue',
        editedKVs: {},
      });

      expect(routingPort.emitRouteFailed).toHaveBeenCalled();

      storage.updateJobStatus.mockReset();
      storage.updateJobStatus.mockResolvedValue(undefined);

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 's1-after-s4b' },
      });

      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });
  });
});
