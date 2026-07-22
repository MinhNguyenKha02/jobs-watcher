import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobIngestor } from '../../../src/application/ingestor.js';
import { JobStage, JobStatus, JobSource } from '../../../src/domain/types/job-lifecycle.js';

function mockPort() {
  return {
    upsert: vi.fn(),
    updateStage: vi.fn(),
    findById: vi.fn(),
  };
}

function mockParsePort() {
  return {
    emitGenerated: vi.fn(),
    emitCompleted: vi.fn(),
    emitFailed: vi.fn(),
  };
}

function mockRoutingPort() {
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

describe('JobIngestor', () => {
  let ingestor: JobIngestor;
  let storage: ReturnType<typeof mockPort>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;

  beforeEach(() => {
    storage = mockPort();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    ingestor = new JobIngestor(storage, parsePort, routingPort);
  });

  describe('processIngestCommand — BROWSER_AUTO PARTIAL_PARSED', () => {
    it('calls emitGenerated when rawPayload is provided', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'msg-001' },
      });
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitGenerated).toHaveBeenCalled();
    });

    it('falls back to signal1BrowserAutoFallback when only jobLifecycleId', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'existing-id' }));
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        jobLifecycleId: 'existing-id',
      });
      expect(storage.findById).toHaveBeenCalledWith('existing-id');
      expect(parsePort.emitGenerated).toHaveBeenCalled();
    });
  });

  describe('processIngestCommand — BROWSER_AUTO FULL_PARSED (signal2c)', () => {
    it('parses HTML and emits completed', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'browser-job', raw: makeTopCvHtml() }));
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        jobLifecycleId: 'browser-job',
      });
      expect(storage.findById).toHaveBeenCalledWith('browser-job');
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('processIngestCommand — MANUAL FULL_PARSED', () => {
    it('signal2aManual with jobLifecycleId processes successfully', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'manual-job' }));
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
        jobLifecycleId: 'manual-job',
      });
      expect(storage.findById).toHaveBeenCalledWith('manual-job');
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });

    it('signal2bManual without jobLifecycleId treats as clipboard ingest', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.MANUAL,
        stage: JobStage.FULL_PARSED,
        rawPayload: makeTopCvHtml(),
      });
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitCompleted).toHaveBeenCalled();
    });
  });

  describe('processResolutionCommand — [j] guard', () => {
    it('rejects queue when status !== ENRICHED', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'guard-job', status: JobStatus.ENRICHING }));
      await ingestor.processResolutionCommand({
        jobLifecycleId: 'guard-job',
        action: 'queue',
        editedKVs: {},
      });
      expect(storage.updateStage).not.toHaveBeenCalled();
      expect(routingPort.emitJobQueued).not.toHaveBeenCalled();
    });

    it('accepts queue when status === ENRICHED', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'enriched-job', status: JobStatus.ENRICHED }));
      await ingestor.processResolutionCommand({
        jobLifecycleId: 'enriched-job',
        action: 'queue',
        editedKVs: {},
      });
      expect(storage.updateStage).toHaveBeenCalled();
      expect(routingPort.emitJobQueued).toHaveBeenCalled();
    });

    it('trash passes through regardless of status', async () => {
      storage.findById.mockResolvedValue(makeStage1Partial({ _id: 'trash-job', status: JobStatus.ENRICHING }));
      await ingestor.processResolutionCommand({
        jobLifecycleId: 'trash-job',
        action: 'trash',
        editedKVs: { reason: 'not interested' },
      });
      expect(storage.updateStage).toHaveBeenCalled();
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    });
  });

  describe('dedup (E11000)', () => {
    it('trashes duplicates and does not emit generated', async () => {
      storage.upsert.mockRejectedValue({ code: 11000 });
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'dedup-msg' },
      });
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
    });
  });
});
