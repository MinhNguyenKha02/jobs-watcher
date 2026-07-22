import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/services/job-extraction.js', () => ({
  JobExtractionService: vi.fn(() => ({
    extractAllJobs: vi.fn(() => { throw new Error('Extraction engine crashed'); }),
  })),
}));

const { default: JobIngestor } = await import('../../../src/application/ingestor.js');
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

describe('Ingestor extraction failure', () => {
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

  describe('signal1BrowserAutoXorManual — extraction throw', () => {
    it('emits jobGeneratedFailed when JobExtractionService.extractAllJobs throws', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '<html>any content</html>',
        metadata: { messageId: 'extract-fail-msg' },
      });

      expect(parseEventPort.emitJobGeneratedFailed).toHaveBeenCalledWith(
        'extract-fail-msg',
        expect.objectContaining({
          stage: JobStage.PARTIAL_PARSED,
          source: JobSource.BROWSER_AUTO,
          error: expect.stringContaining('Extraction engine crashed'),
        })
      );
    });

    it('does not emit job.generated or upsert when extraction throws', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '<html>any</html>',
        metadata: { messageId: 'extract-no-gen' },
      });

      expect(parseEventPort.emitJobGenerated).not.toHaveBeenCalled();
      expect(storage.upsertJobLifecycle).not.toHaveBeenCalled();
    });

    it('handles missing messageId in emitJobGeneratedFailed', async () => {
      await ingestor.processIngestCommand({
        source: JobSource.BROWSER_AUTO,
        stage: JobStage.PARTIAL_PARSED,
        rawPayload: '<html>any</html>',
      });

      expect(parseEventPort.emitJobGeneratedFailed).toHaveBeenCalledWith(
        'unknown',
        expect.any(Object)
      );
    });

    it('gracefully handles extraction failure without ports', async () => {
      const standalone = new JobIngestor();
      await expect(
        standalone.processIngestCommand({
          source: JobSource.BROWSER_AUTO,
          stage: JobStage.PARTIAL_PARSED,
          rawPayload: '<html>any</html>',
        })
      ).resolves.toBeUndefined();
    });
  });
});
