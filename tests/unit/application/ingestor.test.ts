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

function mockQueue() {
  return {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    size: vi.fn(),
    onEnqueue: vi.fn(),
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

/** TopCV single-job HTML — parseTopCV path, no url extracted → emitGenerated */
function makeTopCvHtml(): string {
  return '<div class="job-detail__info--title"><h1>Junior Software Engineer</h1></div>'
    + '<div class="company-name-label"><a class="name">Junior Co</a></div>'
    + '<div class="job-detail__body"><p>Node.js and TypeScript skills required</p></div>';
}

/** Indeed notification HTML — parseIndeed path, has applystart url → enqueue */
function makeIndeedHtmlWithUrl(): string {
  return '<html><body>Indeed Job Alert'
    + '<table><tr><td class="pb-24">'
    + '<h2 class="strong-text-link"><a href="https://vn.indeed.com/applystart?jk=abc123">Senior Backend Engineer</a></h2>'
    + '<div style="color:#2d2d2d">Senior Co</div>'
    + '</td></tr></table>'
    + '</body></html>';
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
  let queue: ReturnType<typeof mockQueue>;
  let parsePort: ReturnType<typeof mockParsePort>;
  let routingPort: ReturnType<typeof mockRoutingPort>;

  beforeEach(() => {
    storage = mockPort();
    queue = mockQueue();
    parsePort = mockParsePort();
    routingPort = mockRoutingPort();
    ingestor = new JobIngestor(storage, parsePort, routingPort, queue);
  });

  describe('processIngestCommand — BROWSER_AUTO PARTIAL_PARSED', () => {
    it('calls emitGenerated when rawPayload is provided (no url)', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'msg-001' },
      });
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
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

  describe('Case A: job has url → enqueue to extraction queue', () => {
    it('enqueues when extracted job has a url', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeIndeedHtmlWithUrl(),
        metadata: { messageId: 'url-msg' },
      });
      expect(storage.upsert).toHaveBeenCalled();
      expect(queue.enqueue).toHaveBeenCalled();
      expect(parsePort.emitGenerated).not.toHaveBeenCalled();
    });
  });

  describe('Case B: job has no url → emitGenerated only', () => {
    it('emits generated when no url', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: makeTopCvHtml(),
        metadata: { messageId: 'nourl-msg' },
      });
      expect(storage.upsert).toHaveBeenCalled();
      expect(parsePort.emitGenerated).toHaveBeenCalled();
      expect(queue.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('Filter rejection', () => {
    it('trashes job when filter rejects', async () => {
      const nonJobHtml = '<html><body><div>Totally not a job posting</div></body></html>';
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: nonJobHtml,
        metadata: { messageId: 'nonjob-msg' },
      });
      expect(routingPort.emitJobTrashed).toHaveBeenCalled();
      expect(storage.upsert).not.toHaveBeenCalled();
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
