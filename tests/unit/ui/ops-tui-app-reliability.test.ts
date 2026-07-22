import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_STATE_PATH = '/tmp/test-tui-state-reliability.json';
if (existsSync(TEST_STATE_PATH)) unlinkSync(TEST_STATE_PATH);
try { unlinkSync(TEST_STATE_PATH + '.lock'); } catch {}
process.env.TUI_SHARED_STATE_PATH = TEST_STATE_PATH;

const mockConnect = vi.fn<[], Promise<void>>();
const mockDisconnect = vi.fn();
const mockIsConnected = vi.fn();
const mockAddEventListener = vi.fn();
const mockPeekNextJob = vi.fn();
const mockNextJob = vi.fn();
const mockGetQueueDepth = vi.fn();
const mockRenderCard = vi.fn();
const mockWrite = vi.fn();
const mockEnableRawMode = vi.fn();
const mockRestoreTerminal = vi.fn();

vi.mock('../../../src/ui/components/SseJobReader.js', () => ({
  SseJobReader: vi.fn(() => ({
    connect: mockConnect,
    disconnect: mockDisconnect,
    isConnected: mockIsConnected,
    addEventListener: mockAddEventListener,
    peekNextJob: mockPeekNextJob,
    nextJob: mockNextJob,
    getQueueDepth: mockGetQueueDepth,
  })),
}));

vi.mock('../../../src/ui/components/JobCardRenderer.js', () => ({
  JobCardRenderer: vi.fn(() => ({ renderCard: mockRenderCard })),
}));

vi.mock('../../../src/ui/components/AnsiTerminal.js', () => ({
  AnsiTerminal: vi.fn(() => ({
    enableRawMode: mockEnableRawMode,
    restoreTerminal: mockRestoreTerminal,
    write: mockWrite,
  })),
}));

vi.mock('../../../src/ui/components/PreviewViewerModal.js', () => ({
  renderPreviewViewerModal: vi.fn(() => '[preview modal frame]'),
}));

process.exit = vi.fn() as any;

const { resetState, setQueueMode, getQueueMode, getCurrentJob } = await import('../../../src/presentation/tui/shared-tui-state.js' );
const { OpsTuiApp } = await import('../../../src/presentation/tui/ops-tui-app.js' );

function cleanState() {
  try { unlinkSync(TEST_STATE_PATH); } catch {}
}

describe('OpsTuiApp reliability cycle (S4→clear→next dequeue)', () => {
  let app: OpsTuiApp;
  let eventHandlers: Record<string, (event: any) => void>;

  function setupDefaultMocks() {
    mockConnect.mockResolvedValue(undefined);
    mockIsConnected.mockReturnValue(true);
    mockRenderCard.mockReturnValue('[rendered-card]');
    mockWrite.mockImplementation(() => {});
    mockPeekNextJob.mockReturnValue(null);
    mockNextJob.mockResolvedValue(null);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    cleanState();
    resetState();
    setupDefaultMocks();
    mockAddEventListener.mockImplementation((type: string, cb: any) => {
      eventHandlers[type] = cb;
    });
    eventHandlers = {};

    app = new OpsTuiApp({
      sseBaseUrl: 'http://localhost:3000',
      sseToken: 'test-token',
    });
  });

  afterEach(() => {
    app.stop();
    cleanState();
  });

  async function runApp(during: () => void | Promise<void>): Promise<void> {
    vi.useFakeTimers();
    try {
      const p = app.start();
      await vi.advanceTimersByTimeAsync(300);
      await during();
      app.stop();
      await vi.advanceTimersByTimeAsync(500);
      await p.catch(() => {});
    } finally {
      vi.useRealTimers();
    }
  }

  it('after S4 parse.failed clears displayed job, next S1 is dequeued', async () => {
    const jobA = { _id: 'job-s4-A', company: 'ACo', role: 'Engineer A' };
    const jobB = { _id: 'job-s4-B', company: 'BCo', role: 'Engineer B' };

    mockPeekNextJob
      .mockReturnValueOnce(jobA)
      .mockReturnValueOnce(jobB);
    mockNextJob
      .mockResolvedValueOnce(jobA)
      .mockResolvedValueOnce(jobB);

    await runApp(async () => {
      expect(mockNextJob).toHaveBeenCalledTimes(1);

      eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'job-s4-A', error: 'Parse error' } });

      await vi.advanceTimersByTimeAsync(300);
    });

    const renderedIds = mockRenderCard.mock.calls
      .filter((c: any[]) => c[0] !== null)
      .map((c: any[]) => c[0]._id);
    expect(renderedIds).toContain('job-s4-B');
  });

  it('after S3 route.queued clears displayed job, next S1 is dequeued', async () => {
    const jobA = { _id: 'job-s3-A', company: 'ACo', role: 'Engineer A' };
    const jobB = { _id: 'job-s3-B', company: 'BCo', role: 'Engineer B' };

    mockPeekNextJob
      .mockReturnValueOnce(jobA)
      .mockReturnValueOnce(jobB);
    mockNextJob
      .mockResolvedValueOnce(jobA)
      .mockResolvedValueOnce(jobB);

    await runApp(async () => {
      expect(mockNextJob).toHaveBeenCalledTimes(1);

      eventHandlers['job.route.queued']({ data: { joblifecycleId: 'job-s3-A' } });

      await vi.advanceTimersByTimeAsync(300);
    });

    const renderedIds = mockRenderCard.mock.calls
      .filter((c: any[]) => c[0] !== null)
      .map((c: any[]) => c[0]._id);
    expect(renderedIds).toContain('job-s3-B');
  });

  it('after S3 route.trashed clears displayed job, next S1 is dequeued', async () => {
    const jobA = { _id: 'job-trash-A', company: 'ACo', role: 'Engineer A' };
    const jobB = { _id: 'job-trash-B', company: 'BCo', role: 'Engineer B' };

    mockPeekNextJob
      .mockReturnValueOnce(jobA)
      .mockReturnValueOnce(jobB);
    mockNextJob
      .mockResolvedValueOnce(jobA)
      .mockResolvedValueOnce(jobB);

    await runApp(async () => {
      expect(mockNextJob).toHaveBeenCalledTimes(1);

      eventHandlers['job.route.trashed']({ data: { joblifecycleId: 'job-trash-A' } });

      await vi.advanceTimersByTimeAsync(300);
    });

    const renderedIds = mockRenderCard.mock.calls
      .filter((c: any[]) => c[0] !== null)
      .map((c: any[]) => c[0]._id);
    expect(renderedIds).toContain('job-trash-B');
  });

  it('after S4 route.failed clears displayed job, next S1 is dequeued', async () => {
    const jobA = { _id: 'job-rf-A', company: 'ACo', role: 'Engineer A' };
    const jobB = { _id: 'job-rf-B', company: 'BCo', role: 'Engineer B' };

    mockPeekNextJob
      .mockReturnValueOnce(jobA)
      .mockReturnValueOnce(jobB);
    mockNextJob
      .mockResolvedValueOnce(jobA)
      .mockResolvedValueOnce(jobB);

    await runApp(async () => {
      expect(mockNextJob).toHaveBeenCalledTimes(1);

      eventHandlers['job.route.failed']({ data: { joblifecycleId: 'job-rf-A', error: 'Route error' } });

      await vi.advanceTimersByTimeAsync(300);
    });

    const renderedIds = mockRenderCard.mock.calls
      .filter((c: any[]) => c[0] !== null)
      .map((c: any[]) => c[0]._id);
    expect(renderedIds).toContain('job-rf-B');
  });

  it('multiple failures still allow dequeuing', async () => {
    const jobA = { _id: 'job-mf-A', company: 'ACo', role: 'Engineer A' };
    const jobB = { _id: 'job-mf-B', company: 'BCo', role: 'Engineer B' };

    mockPeekNextJob
      .mockReturnValueOnce(jobA)
      .mockReturnValueOnce(jobB);
    mockNextJob
      .mockResolvedValueOnce(jobA)
      .mockResolvedValueOnce(jobB);

    await runApp(async () => {
      expect(mockNextJob).toHaveBeenCalledTimes(1);

      eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'job-mf-A', error: 'Parse error' } });
      await vi.advanceTimersByTimeAsync(300);

      eventHandlers['job.route.failed']({ data: { joblifecycleId: 'job-mf-B', error: 'Route error' } });
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(mockRenderCard).toHaveBeenCalledWith(null, expect.any(Object));
  });

  describe('Signal 2 (job.parse.completed) handler', () => {
    it('direct mode accepts any lifecycleId (latest-wins)', async () => {
      const job = { _id: 'direct-job', company: 'DC', role: 'Direct' };

      await runApp(async () => {
        setQueueMode(false);

        eventHandlers['job.parse.completed']({ data: { joblifecycleId: 'direct-job-a', matchResult: 'match-1' } });
        await vi.advanceTimersByTimeAsync(50);

        eventHandlers['job.parse.completed']({ data: { joblifecycleId: 'direct-job-b', matchResult: 'match-2' } });
        await vi.advanceTimersByTimeAsync(50);
      });

      const renderCallsWithJob = mockRenderCard.mock.calls.filter((c: any[]) => c[0] !== null);
      const lastJob = renderCallsWithJob[renderCallsWithJob.length - 1];
      expect(lastJob).toBeDefined();
      expect(mockNextJob).toHaveBeenCalledTimes(0);
    });

    it('queue mode rejects different lifecycleId (cross-job guard)', async () => {
      const jobA = { _id: 'q-job-A', company: 'QC', role: 'Queue A' };

      mockPeekNextJob.mockReturnValueOnce(jobA);
      mockNextJob.mockResolvedValueOnce(jobA);

      await runApp(async () => {
        expect(mockNextJob).toHaveBeenCalledTimes(1);

        const callsBefore = mockRenderCard.mock.calls.length;

        eventHandlers['job.parse.completed']({ data: { joblifecycleId: 'q-job-OTHER', matchResult: 'alien-match' } });
        await vi.advanceTimersByTimeAsync(100);

        expect(mockRenderCard.mock.calls.length).toBe(callsBefore);
        expect(mockRenderCard).toHaveBeenLastCalledWith(jobA, expect.any(Object));
      });
    });

    it('deferred enrichment — !currentJob && isQueueMode skips S2', async () => {
      const jobA = { _id: 'def-job-A', company: 'DC', role: 'Defer A' };
      const jobB = { _id: 'def-job-B', company: 'DC', role: 'Defer B' };

      mockPeekNextJob
        .mockReturnValueOnce(jobA)
        .mockReturnValueOnce(jobB);
      mockNextJob
        .mockResolvedValueOnce(jobA)
        .mockResolvedValueOnce(jobB);

      await runApp(async () => {
        expect(mockNextJob).toHaveBeenCalledTimes(1);

        eventHandlers['job.route.queued']({ data: { joblifecycleId: 'def-job-A' } });
        await vi.advanceTimersByTimeAsync(50);

        const callsAfterClear = mockRenderCard.mock.calls.length;

        eventHandlers['job.parse.completed']({ data: { joblifecycleId: 'def-job-deferred', matchResult: 'deferred' } });
        await vi.advanceTimersByTimeAsync(50);

        expect(mockRenderCard.mock.calls.length).toBe(callsAfterClear);

        await vi.advanceTimersByTimeAsync(400);
      });

      const renderedIds = mockRenderCard.mock.calls
        .filter((c: any[]) => c[0] !== null)
        .map((c: any[]) => c[0]._id);
      expect(renderedIds).toContain('def-job-B');
    });
  });

  describe('Signal 4 (onRouteEvent) handler', () => {
    it('parse.failed in direct mode — matching lifecycleId clears, non-matching ignores', async () => {
      await runApp(async () => {
        setQueueMode(false);

        eventHandlers['job.parse.completed']({
          data: { _id: 's4-d-job', joblifecycleId: 's4-d-job', matchResult: 'ok' },
        });
        await vi.advanceTimersByTimeAsync(50);

        expect(mockRenderCard).toHaveBeenLastCalledWith(
          expect.objectContaining({ _id: 's4-d-job', joblifecycleId: 's4-d-job' }),
          expect.any(Object),
        );

        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 's4-d-job', error: 'Bad parse' } });
        await vi.advanceTimersByTimeAsync(50);

        expect(mockRenderCard).toHaveBeenLastCalledWith(null, expect.any(Object));

        eventHandlers['job.parse.completed']({
          data: { _id: 's4-d-job-2', joblifecycleId: 's4-d-job-2', matchResult: 'ok-2' },
        });
        await vi.advanceTimersByTimeAsync(100);

        const callsAfterReRender = mockRenderCard.mock.calls.length;

        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'NON-MATCHING-ID', error: 'Noise' } });
        await vi.advanceTimersByTimeAsync(50);

        expect(mockRenderCard.mock.calls.length).toBe(callsAfterReRender);
      });
    });

    it('lastClearedJoblifecycleId duplicate skip guard', async () => {
      const jobA = { _id: 'dedup-job-A', company: 'DU', role: 'Dedup A' };
      const jobB = { _id: 'dedup-job-B', company: 'DU', role: 'Dedup B' };

      mockPeekNextJob
        .mockReturnValueOnce(jobA)
        .mockReturnValueOnce(jobB);
      mockNextJob
        .mockResolvedValueOnce(jobA)
        .mockResolvedValueOnce(jobB);

      await runApp(async () => {
        expect(mockNextJob).toHaveBeenCalledTimes(1);

        eventHandlers['job.route.queued']({ data: { joblifecycleId: 'dedup-job-A' } });
        await vi.advanceTimersByTimeAsync(50);

        const nullRenderCount1 = mockRenderCard.mock.calls.filter((c: any[]) => c[0] === null).length;

        eventHandlers['job.route.queued']({ data: { joblifecycleId: 'dedup-job-A' } });
        await vi.advanceTimersByTimeAsync(50);

        const nullRenderCount2 = mockRenderCard.mock.calls.filter((c: any[]) => c[0] === null).length;
        expect(nullRenderCount2).toBe(nullRenderCount1);
      });
    });
  });

  describe('mode toggle', () => {
    it('toggling queue→direct during active job re-renders', async () => {
      const jobA = { _id: 'mode-toggle-job', company: 'MT', role: 'Mode Toggle' };

      mockPeekNextJob.mockReturnValueOnce(jobA);
      mockNextJob.mockResolvedValueOnce(jobA);

      await runApp(async () => {
        expect(mockNextJob).toHaveBeenCalledTimes(1);

        expect(mockRenderCard).toHaveBeenLastCalledWith(jobA, expect.objectContaining({ queueMode: true }));

        setQueueMode(false);
        await vi.advanceTimersByTimeAsync(200);

        expect(mockRenderCard).toHaveBeenLastCalledWith(null, expect.objectContaining({ queueMode: false }));
      });
    });
  });
});
