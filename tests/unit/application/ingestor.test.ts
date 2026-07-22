import { describe, it, expect, vi, beforeEach } from 'vitest';
import JobIngestor from '../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js' ;

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

// TopCV HTML that parser extracts a junior-level job (must pass filter)
function makeTopCvHtml(): string {
  return '<div class="job-detail__info--title"><h1>Junior Engineer</h1></div>'
    + '<div class="company-name-label"><a class="name">Junior Co</a></div>'
    + '<div>topcv</div>';
}

// Indeed HTML that parser extracts a junior job with rc/clk/dl URL
function makeIndeedHtml(): string {
  return '<div class="job-item">'
    + '<h2><a href="https://vn.indeed.com/rc/clk/dl?jk=abc123">Junior Engineer</a></h2>'
    + '</div>'
    + '<p>Junior Co - Hanoi</p>'
    + '<span>indeed.com</span>';
}

function makeNonJobHtml(): string {
  return '<html><body><div>no job data here</div></body></html>';
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

describe('JobIngestor', () => {
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

  describe('processIngestCommand — dispatch routing', () => {
    it('calls signal1BrowserAutoXorManual when PARTIAL_PARSED with rawPayload', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'msg-001' },
      });

      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });

    it('calls signal1BrowserAutoFallback when PARTIAL_PARSED with only joblifecycleId', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({ _id: 'existing-id' }));

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '',
        joblifecycleId: 'existing-id',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalledWith('existing-id');
      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });

    it('calls signal2cBrowserAuto when FULL_PARSED + BROWSER_AUTO', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({ _id: 'browser-job', raw: makeTopCvHtml() }));

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'browser-job',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalledWith('browser-job');
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });

    it('calls signal2aManual when FULL_PARSED + MANUAL with joblifecycleId', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({
        _id: 'manual-job',
        source: JobSource.MANUAL,
      }));

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'manual-job',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalledWith('manual-job');
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });

    it('calls signal2bManual when FULL_PARSED + MANUAL without joblifecycleId', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
      });

      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });

    it('skips FULL_PARSED enrichment when job is already FULL_PARSED (B9 guard)', async () => {
      const fullParsedJob = makeStage1Partial({
        _id: 'full-parsed-job',
        source: JobSource.MANUAL,
        status: JobStatus.ENRICHED,
        stage: JobStage.FULL_PARSED,
      });
      storage.findJobLifecycleById.mockResolvedValue(fullParsedJob);

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'full-parsed-job',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalledWith('full-parsed-job');
      expect(storage.upsertJobLifecycle).not.toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).not.toHaveBeenCalled();
    });

    it('calls signal2cBrowserAuto even without joblifecycleId (fallback ID)', async () => {
      storage.findJobLifecycleById.mockResolvedValue(null);

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
      });

      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });
  });

  describe('signal1BrowserAutoXorManual edge cases', () => {
    it('creates fallback job when 0 jobs extracted', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeNonJobHtml(),
        metadata: { messageId: 'msg-empty', subject: 'Junior Engineer' },
      });

      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });

    it('handles duplicate (MongoDB 11000) by emitting trashed', async () => {
      storage.upsertJobLifecycle.mockRejectedValue({ code: 11000 });

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'msg-dup' },
      });

      expect(routingPort.emitJobTrashed).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Duplicate')
      );
    });

    it('defers Indeed URLs to extraction queue', async () => {
      storage.extractionQueue.enqueue = vi.fn();

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeIndeedHtml(),
        metadata: { messageId: 'msg-indeed' },
      });

      expect(storage.extractionQueue.enqueue).toHaveBeenCalled();
    });

  });

  describe('signal2aManual edge cases', () => {
    it('emits parse.failed on empty payload', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: '   ',
        joblifecycleId: 'job-empty',
      });

      expect(parseEventPort.emitParseFailed).toHaveBeenCalledWith(
        'job-empty',
        expect.objectContaining({ error: 'Empty HTML payload' })
      );
      expect(storage.updateJobStatus).toHaveBeenCalledWith(
        expect.any(String),
        JobStatus.FAILED,
        'Empty HTML payload'
      );
    });

    it('emits parse.failed on HTML parse failure', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeNonJobHtml(),
        joblifecycleId: 'job-noparse',
      });

      expect(parseEventPort.emitParseFailed).toHaveBeenCalledWith(
        'job-noparse',
        expect.objectContaining({ error: 'HTML parse failed' })
      );
    });
  });

  describe('signal2bManual edge cases', () => {
    it('emits parse.failed on HTML parse failure', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeNonJobHtml(),
      });

      expect(parseEventPort.emitParseFailed).toHaveBeenCalledWith(
        expect.stringContaining('clip-'),
        expect.objectContaining({ error: 'HTML parse failed' })
      );
    });

    it('silently skips duplicate (MongoDB 11000) without parse.failed', async () => {
      storage.upsertJobLifecycle.mockRejectedValue({ code: 11000 });

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
      });

      expect(parseEventPort.emitParseFailed).not.toHaveBeenCalled();
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
    });

    it('skips duplicate (MongoDB 11000) without crashing', async () => {
      storage.upsertJobLifecycle.mockRejectedValue({ code: 11000 });

      await expect(
        ingestor.processIngestCommand({
          source: JobSource.MANUAL,
          stage: JobStage.FULL_PARSED,
          rawPayload: makeTopCvHtml(),
        })
      ).resolves.toBeUndefined();
      expect(parseEventPort.emitParseFailed).not.toHaveBeenCalled();
    });
  });

  describe('signal1BrowserAutoXorManual extraction fallback', () => {
    it('creates fallback job when extraction returns empty', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '<html>no job data</html>',
        metadata: { messageId: 'msg-empty-fallback', subject: 'Junior Engineer Position' },
      });

      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });
  });

  describe('signal1BrowserAutoFallback', () => {
    it('emits job.generated when existing lifecycle found', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({ _id: 'fb-job' }));

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '',
        joblifecycleId: 'fb-job',
      });

      expect(parseEventPort.emitJobGenerated).toHaveBeenCalled();
    });

    it('silent no-op when lifecycle not found', async () => {
      storage.findJobLifecycleById.mockResolvedValue(null);

      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '',
        joblifecycleId: 'missing-job',
      });

      expect(parseEventPort.emitJobGenerated).not.toHaveBeenCalled();
      expect(parseEventPort.emitJobGeneratedFailed).not.toHaveBeenCalled();
    });
  });

  describe('processResolutionCommand', () => {
    beforeEach(() => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({
        _id: 'resolve-job',
        status: JobStatus.ENRICHED,
        stage: JobStage.FULL_PARSED,
      }));
    });

    it('queues a job when action=queue', async () => {
      await ingestor.processResolutionCommand({ joblifecycleId: 'resolve-job', action: 'queue' });

      expect(storage.updateJobStatus).toHaveBeenCalledWith('resolve-job', JobStatus.QUEUED);
      expect(routingPort.emitJobQueued).toHaveBeenCalled();
    });

    it('trashes a job when action=trash', async () => {
      await ingestor.processResolutionCommand({ joblifecycleId: 'resolve-job', action: 'trash' });

      expect(storage.updateJobStatus).toHaveBeenCalledWith('resolve-job', JobStatus.TRASHED, 'operator:trash');
      expect(routingPort.emitJobTrashed).toHaveBeenCalledWith(
        'resolve-job', 'operator:trash',
        expect.objectContaining({ operatorEdits: undefined })
      );
    });

    it('passes editedKVs to routing port', async () => {
      await ingestor.processResolutionCommand({
        joblifecycleId: 'resolve-job', action: 'queue',
        editedKVs: { company: 'New Co' },
      });

      expect(routingPort.emitJobQueued).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'New Co' }),
        expect.any(Object)
      );
    });

    it('is no-op when joblifecycleId is empty', async () => {
      await ingestor.processResolutionCommand({ joblifecycleId: '', action: 'queue' });

      expect(storage.updateJobStatus).not.toHaveBeenCalled();
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('emits route.failed on storage error', async () => {
      storage.updateJobStatus.mockRejectedValue(new Error('DB connection lost'));

      await ingestor.processResolutionCommand({
        joblifecycleId: 'resolve-job', action: 'queue',
        editedKVs: { company: 'New Co' },
      });

      expect(routingPort.emitRouteFailed).toHaveBeenCalledWith(
        'resolve-job', 'DB connection lost',
        expect.objectContaining({ operatorEdits: { company: 'New Co' } })
      );
    });

    it('silently handles empty action string', async () => {
      await ingestor.processResolutionCommand({ joblifecycleId: 'job-noop', action: '' as any });

      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
      expect(routingPort.emitJobTrashed).not.toHaveBeenCalled();
    });
  });

  describe('null-safe without ports', () => {
    it('works with no storage or ports', async () => {
      const standalone = new JobIngestor();
      await expect(
        standalone.processIngestCommand({
          source: JobSource.MANUAL, stage: JobStage.FULL_PARSED,
          rawPayload: makeTopCvHtml(),
        })
      ).resolves.toBeUndefined();
      await expect(
        standalone.processResolutionCommand({ joblifecycleId: 'test', action: 'queue' })
      ).resolves.toBeUndefined();
    });
  });

  describe('B8/B9 fixes: empty HTML and missing joblifecycleId', () => {
    it('empty HTML in signal2aManual emits parse.failed and sets FAILED status (B8)', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({ _id: 'b8-job' }));

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: '',
        joblifecycleId: 'b8-job',
      });

      expect(parseEventPort.emitParseFailed).toHaveBeenCalledWith(
        'b8-job',
        expect.objectContaining({ error: 'Empty HTML payload' })
      );
      expect(storage.updateJobStatus).toHaveBeenCalledWith('b8-job', JobStatus.FAILED, 'Empty HTML payload');
    });

    it('valid HTML with joblifecycleId in signal2aManual processes successfully', async () => {
      storage.findJobLifecycleById.mockResolvedValue(makeStage1Partial({
        _id: 'b9-job',
        source: JobSource.MANUAL,
      }));

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'b9-job',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalledWith('b9-job');
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });


  });

  describe('queryJobLifecycleWithRetry', () => {
    it('continues processing when stage1 not found (null stage1Partial is accepted)', async () => {
      storage.findJobLifecycleById.mockResolvedValue(null);

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'retry-exhaust',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalled();
      // signal2aManual continues with null stage1Partial:
      // builds stage2 job, filters, scores, upserts
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });

    it('recovers on backoff when stage1 doc appears mid-retry', async () => {
      storage.findJobLifecycleById
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeStage1Partial({ _id: 'retry-late-doc' }));

      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        joblifecycleId: 'retry-late-doc',
      });

      expect(storage.findJobLifecycleById).toHaveBeenCalledTimes(3);
      expect(storage.upsertJobLifecycle).toHaveBeenCalled();
      expect(parseEventPort.emitParseCompleted).toHaveBeenCalled();
    });
  });
});
