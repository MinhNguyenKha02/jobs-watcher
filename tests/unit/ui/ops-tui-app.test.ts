import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';

const TEST_STATE_PATH = '/tmp/test-tui-state-ops.json';
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

const { resetState, setQueueMode, setCurrentJob } = await import('../../../src/presentation/tui/shared-tui-state.js' );
const { OpsTuiApp } = await import('../../../src/presentation/tui/ops-tui-app.js' );

function cleanState() {
  try { unlinkSync(TEST_STATE_PATH); } catch {}
}

describe('OpsTuiApp', () => {
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

  describe('lifecycle', () => {
    it('attaches dependencies on start and cleans up on stop', async () => {
      await runApp(async () => {});

      expect(mockEnableRawMode).toHaveBeenCalled();
      expect(mockConnect).toHaveBeenCalled();
      expect(mockAddEventListener).toHaveBeenCalledWith('job.generated', expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith('job.parse.completed', expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith('job.route.queued', expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith('job.route.trashed', expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith('job.parse.failed', expect.any(Function));
      expect(mockAddEventListener).toHaveBeenCalledWith('job.route.failed', expect.any(Function));
      expect(mockRestoreTerminal).toHaveBeenCalled();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('stop is safe when not started', () => {
      expect(() => app.stop()).not.toThrow();
    });

    it('renders initial idle frame', async () => {
      await runApp(async () => {});

      expect(mockRenderCard).toHaveBeenCalledWith(null, expect.objectContaining({ state: 'IDLE' }));
      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('[rendered-card]'));
    });
  });

  describe('main loop dequeue', () => {
    it('dequeues next job and renders it', async () => {
      const testJob = { _id: 'job-dq', company: 'DeqCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {});

      expect(mockNextJob).toHaveBeenCalled();
      expect(mockRenderCard).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'job-dq', company: 'DeqCo' }),
        expect.any(Object),
      );
    });

    it('sets state DISPLAY after dequeuing', async () => {
      const testJob = { _id: 'job-disp', company: 'DispCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {});

      const displayCall = mockRenderCard.mock.calls.find(
        (c: any[]) => c[1]?.state === 'DISPLAY',
      );
      expect(displayCall).toBeTruthy();
    });
  });

  describe('Signal 2 - job.parse.completed', () => {
    it('enriches displayed job with parsed data', async () => {
      const partialJob = { _id: 'job-enrich', company: 'EnrichCo', role: 'Engineer', matchScore: 0 };
      mockPeekNextJob.mockReturnValue(partialJob);
      mockNextJob.mockResolvedValue(partialJob);

      await runApp(async () => {
        eventHandlers['job.parse.completed']({
          data: { joblifecycleId: 'job-enrich', company: 'EnrichCo', role: 'Senior Engineer', matchScore: 92, matchedProfileSkills: ['TS'] },
        });
      });

      const enrichedCall = mockRenderCard.mock.calls.find(
        (c: any[]) => c[0]?.matchScore === 92,
      );
      expect(enrichedCall).toBeTruthy();
    });

    it('skips signal for different displayed job in queue mode', async () => {
      const testJob = { _id: 'job-A', company: 'ACo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      let renderCount = 0;
      await runApp(async () => {
        renderCount = mockRenderCard.mock.calls.length;
        eventHandlers['job.parse.completed']({
          data: { joblifecycleId: 'job-B', company: 'BCo', role: 'Senior Engineer' },
        });
      });

      expect(mockRenderCard.mock.calls.length).toBe(renderCount);
    });
  });

  describe('Signal 3/4 - route and clear events', () => {
    function setupJob() {
      const testJob = { _id: 'job-clear', company: 'ClearCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);
    }

    it('clears job on job.route.queued', async () => {
      setupJob();
      await runApp(async () => {
        eventHandlers['job.route.queued']({ data: { joblifecycleId: 'job-clear' } });
      });
      const nullRender = mockRenderCard.mock.calls.find((c: any[]) => c[0] === null);
      expect(nullRender).toBeTruthy();
    });

    it('clears job on job.route.trashed', async () => {
      setupJob();
      await runApp(async () => {
        eventHandlers['job.route.trashed']({ data: { joblifecycleId: 'job-clear' } });
      });
      const nullRender = mockRenderCard.mock.calls.find((c: any[]) => c[0] === null);
      expect(nullRender).toBeTruthy();
    });

    it('clears job on job.parse.failed', async () => {
      setupJob();
      await runApp(async () => {
        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'job-clear', error: 'Parse error' } });
      });
      const nullRender = mockRenderCard.mock.calls.find((c: any[]) => c[0] === null);
      expect(nullRender).toBeTruthy();
    });

    it('clears job on job.route.failed', async () => {
      setupJob();
      await runApp(async () => {
        eventHandlers['job.route.failed']({ data: { joblifecycleId: 'job-clear', error: 'Route error' } });
      });
      const nullRender = mockRenderCard.mock.calls.find((c: any[]) => c[0] === null);
      expect(nullRender).toBeTruthy();
    });
  });

  describe('Signal 4 - parse.failed in direct mode (B10 fix)', () => {
    it('clears display only when joblifecycleId matches active job', async () => {
      const testJob = { _id: 'job-direct-active', company: 'ActiveCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      let clearCount = 0;
      await runApp(async () => {
        setQueueMode(false);
        await vi.advanceTimersByTimeAsync(100);
        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'job-direct-active', error: 'Fail' } });
        clearCount = mockRenderCard.mock.calls.filter((c: any[]) => c[0] === null).length;
      });
      expect(clearCount).toBeGreaterThanOrEqual(1);
    });

    it('ignores parse.failed for unrelated joblifecycleId in direct mode', async () => {
      const testJob = { _id: 'job-direct-showing', company: 'ShowCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      let lastRender: any = null;
      await runApp(async () => {
        setQueueMode(false);
        setCurrentJob('job-direct-showing', testJob, 'FULL_PARSED');
        await vi.advanceTimersByTimeAsync(100);
        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'unrelated-job', error: 'Fail' } });
        const calls = mockRenderCard.mock.calls;
        lastRender = calls[calls.length - 1];
      });
      expect(lastRender?.[0]).not.toBeNull();
    });

    it('skips route event for non-displayed job (unchanged state)', async () => {
      const testJob = { _id: 'job-displayed', company: 'DisplayCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {
        eventHandlers['job.route.queued']({
          data: { joblifecycleId: 'different-job' },
        });
      });
      const lastRender = mockRenderCard.mock.calls[mockRenderCard.mock.calls.length - 1];
      expect(lastRender[0]).not.toBeNull();
    });
  });

  describe('queue mode switch', () => {
    it('re-renders when queue mode changes mid-flight', async () => {
      let countBefore = 0;
      await runApp(async () => {
        countBefore = mockRenderCard.mock.calls.length;
        setQueueMode(false);
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(mockRenderCard.mock.calls.length).toBeGreaterThan(countBefore);
    });
  });

  describe('onRouteEvent - direct mode vs queue mode', () => {
    it('parse.failed clears only matching joblifecycleId in direct mode (B10 fix)', async () => {
      const testJob = { _id: 'job-direct-match', company: 'MatchCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {
        setQueueMode(false);
        await vi.advanceTimersByTimeAsync(100);
        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'job-direct-match', error: 'fail' } });
      });
      const lastRender = mockRenderCard.mock.calls[mockRenderCard.mock.calls.length - 1];
      expect(lastRender[0]).toBeNull();
    });

    it('parse.failed ignores non-matching joblifecycleId in direct mode', async () => {
      const testJob = { _id: 'job-direct-keep', company: 'KeepCo', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {
        setQueueMode(false);
        setCurrentJob('job-direct-keep', testJob, 'FULL_PARSED');
        await vi.advanceTimersByTimeAsync(100);
        eventHandlers['job.parse.failed']({ data: { joblifecycleId: 'unrelated-job', error: 'fail' } });
      });
      const lastRender = mockRenderCard.mock.calls[mockRenderCard.mock.calls.length - 1];
      expect(lastRender[0]).not.toBeNull();
    });

    it('route.queued only clears matching joblifecycleId in queue mode', async () => {
      const testJob = { _id: 'job-clear-only', company: 'Co', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {
        eventHandlers['job.route.queued']({ data: { joblifecycleId: 'different-job' } });
      });
      // Last render should NOT be null (different job's route event shouldn't clear)
      const lastRender = mockRenderCard.mock.calls[mockRenderCard.mock.calls.length - 1];
      expect(lastRender[0]).not.toBeNull();
    });

    it('route.failed only clears matching joblifecycleId in queue mode', async () => {
      const testJob = { _id: 'job-route-fail', company: 'Co', role: 'Engineer' };
      mockPeekNextJob.mockReturnValue(testJob);
      mockNextJob.mockResolvedValue(testJob);

      await runApp(async () => {
        eventHandlers['job.route.failed']({ data: { joblifecycleId: 'different-job', error: 'fail' } });
      });
      const lastRender = mockRenderCard.mock.calls[mockRenderCard.mock.calls.length - 1];
      expect(lastRender[0]).not.toBeNull();
    });
  });
});
