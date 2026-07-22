import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockStartSseClient = vi.fn();
let mockSseHandle: any;
let sseCallbacks: any;

vi.mock('../../../src/ui/sse-client.js', () => ({
  default: mockStartSseClient,
}));

const { SseJobReader } = await import('../../../src/presentation/tui/components/SseJobReader.js' );

describe('SseJobReader', () => {
  let reader: InstanceType<typeof SseJobReader>;

  beforeEach(() => {
    mockStartSseClient.mockReset();
    mockSseHandle = { close: vi.fn() };
    sseCallbacks = null as any;
    mockStartSseClient.mockImplementation((_baseUrl: string, _token: string | undefined, opts: any) => {
      sseCallbacks = opts;
      return mockSseHandle;
    });
    reader = new SseJobReader('http://localhost:3000', 'test-token');
  });

  afterEach(() => {
    reader.disconnect();
  });

  function connect() {
    const p = reader.connect();
    sseCallbacks.onOpen();
    return p;
  }

  describe('connect / disconnect', () => {
    it('starts SSE client with baseUrl and token', async () => {
      const connectPromise = reader.connect();
      sseCallbacks.onOpen();
      await connectPromise;

      expect(mockStartSseClient).toHaveBeenCalledWith(
        'http://localhost:3000',
        'test-token',
        expect.objectContaining({
          onOpen: expect.any(Function),
          onMessage: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
      expect(reader.isConnected()).toBe(true);
    });

    it('disconnect closes the SSE handle', async () => {
      const connectPromise = reader.connect();
      sseCallbacks.onOpen();
      await connectPromise;

      reader.disconnect();
      expect(mockSseHandle.close).toHaveBeenCalled();
      expect(reader.isConnected()).toBe(false);
    });

    it('disconnect is safe when not connected', () => {
      expect(() => reader.disconnect()).not.toThrow();
    });

    it('isConnected returns false before connect', () => {
      expect(reader.isConnected()).toBe(false);
    });
  });

  describe('handleSseEvent - job.generated', () => {
    beforeEach(async () => {
      await connect();
    });

    it('buffers a job from job.generated event', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: {
          joblifecycleId: 'job-1',
          company: 'Acme',
          role: 'Junior Engineer',
          location: 'Hanoi',
          url: 'https://acme.com/job',
          matchScore: 85,
          matchedProfileSkills: ['TypeScript'],
        },
      });

      expect(reader.getQueueDepth()).toBe(1);
      const job = reader.peekNextJob();
      expect(job?._id).toBe('job-1');
      expect(job?.company).toBe('Acme');
      expect(job?.role).toBe('Junior Engineer');
    });

    it('queues same-ID job.generated events (duplicate guard is for routed jobs only)', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-dup', company: 'Acme', role: 'Engineer' },
      });
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-dup', company: 'Acme', role: 'Engineer' },
      });

      // Both queued because neither has been routed
      expect(reader.getQueueDepth()).toBe(2);
    });

    it('rejects re-add of already-routed job', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-routed', company: 'RoutedCo', role: 'Engineer' },
      });
      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: 'job-routed' },
      });

      expect(reader.getQueueDepth()).toBe(1);

      // Second job.generated after routing should be skipped
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-routed', company: 'RoutedCo', role: 'Engineer' },
      });

      expect(reader.getQueueDepth()).toBe(1);
    });

    it('uses fallback ID when joblifecycleId is missing', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { company: 'Startup', role: 'Engineer' },
      });

      const job = reader.peekNextJob();
      expect(job?._id).toMatch(/^sse-fallback-/);
    });
  });

  describe('handleSseEvent - routing events', () => {
    beforeEach(async () => {
      await connect();

      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-route', company: 'RouteCo', role: 'Engineer' },
      });
    });

    it('marks job as processed on job.route.queued', () => {
      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: 'job-route' },
      });

      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-next', company: 'NextCo', role: 'Engineer' },
      });

      expect(reader.getQueueDepth()).toBe(2);
    });

    it('marks job as processed on job.route.trashed', () => {
      sseCallbacks.onMessage({
        type: 'job.route.trashed',
        payload: { joblifecycleId: 'job-route' },
      });

      expect(reader.getQueueDepth()).toBe(1);
    });

    it('marks job as processed on job.parse.failed', () => {
      sseCallbacks.onMessage({
        type: 'job.parse.failed',
        payload: { joblifecycleId: 'job-route', error: 'Parse error' },
      });

      expect(reader.getQueueDepth()).toBe(1);
    });

    it('marks job as processed on job.route.failed', () => {
      sseCallbacks.onMessage({
        type: 'job.route.failed',
        payload: { joblifecycleId: 'job-route', error: 'Route error' },
      });

      expect(reader.getQueueDepth()).toBe(1);
    });
  });

  describe('handleSseEvent - job.parse.completed', () => {
    beforeEach(async () => {
      await connect();
    });

    it('merges payload into queued job', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-merge', company: 'MergeCo', role: 'Engineer' },
      });

      sseCallbacks.onMessage({
        type: 'job.parse.completed',
        payload: { joblifecycleId: 'job-merge', company: 'MergeCo', role: 'Senior Engineer', location: 'NYC' },
      });

      const job = reader.peekNextJob();
      expect(job?.role).toBe('Senior Engineer');
      expect(job?.location).toBe('NYC');
    });
  });

  describe('handleSseEvent - processed IDs overflow eviction', () => {
  beforeEach(async () => {
    await connect();
  });

  it('evicts oldest IDs when set exceeds 1000 limit, allowing re-add', () => {
    for (let i = 0; i < 1001; i++) {
      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: `job-evict-${i}` },
      });
    }

    expect(reader.getQueueDepth()).toBe(0);

    sseCallbacks.onMessage({
      type: 'job.generated',
      payload: { joblifecycleId: 'job-evict-0', company: 'ReAddCo', role: 'Engineer' },
    });

    expect(reader.getQueueDepth()).toBe(1);

    sseCallbacks.onMessage({
      type: 'job.generated',
      payload: { joblifecycleId: 'job-evict-500', company: 'SkipCo', role: 'Engineer' },
    });

    expect(reader.getQueueDepth()).toBe(1);
  });
});

describe('handleSseEvent - addProcessedId pruning', () => {
  beforeEach(async () => {
    await connect();
  });

  it('skips routed jobs from queue (drains them in nextJob)', async () => {
    const routedIds = ['job-skip-1', 'job-skip-2', 'job-skip-3'];
    const keepIds = ['job-keep-1', 'job-keep-2'];

    for (const id of routedIds) {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: id, company: 'SkipCo', role: 'Engineer' },
      });
    }
    for (const id of keepIds) {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: id, company: 'KeepCo', role: 'Engineer' },
      });
    }

    for (const id of routedIds) {
      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: id },
      });
    }

    expect(reader.getQueueDepth()).toBe(5);

    const first = await reader.nextJob();
    expect(first?._id).toBe('job-keep-1');

    const second = await reader.nextJob();
    expect(second?._id).toBe('job-keep-2');
  });

  it('rejects re-add of already-processed job after routing', async () => {
    sseCallbacks.onMessage({
      type: 'job.generated',
      payload: { joblifecycleId: 'job-routed', company: 'Co', role: 'Engineer' },
    });
    sseCallbacks.onMessage({
      type: 'job.route.trashed',
      payload: { joblifecycleId: 'job-routed' },
    });

    sseCallbacks.onMessage({
      type: 'job.generated',
      payload: { joblifecycleId: 'job-routed', company: 'Co', role: 'Engineer' },
    });

    expect(reader.getQueueDepth()).toBe(1);
  });
});

describe('handleSseEvent - routing events without joblifecycleId', () => {
    beforeEach(async () => {
      await connect();
    });

    it('skips job.route.queued without joblifecycleId (no crash)', () => {
      expect(() => {
        sseCallbacks.onMessage({
          type: 'job.route.queued',
          payload: {},
        });
      }).not.toThrow();
    });

    it('skips job.route.trashed without joblifecycleId (no crash)', () => {
      expect(() => {
        sseCallbacks.onMessage({
          type: 'job.route.trashed',
          payload: {},
        });
      }).not.toThrow();
    });
  });

  describe('handleSseEvent - all signal types emit to listeners', () => {
    beforeEach(async () => {
      await connect();
    });

    it('emits job.generated to listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.generated', listener);
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-s1', company: 'S1Co', role: 'Engineer' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('emits job.parse.completed to listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.parse.completed', listener);
      sseCallbacks.onMessage({
        type: 'job.parse.completed',
        payload: { joblifecycleId: 'job-s2', matchScore: 85 },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('emits job.route.queued to listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.route.queued', listener);
      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: 'job-s3a' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('emits job.route.trashed to listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.route.trashed', listener);
      sseCallbacks.onMessage({
        type: 'job.route.trashed',
        payload: { joblifecycleId: 'job-s3b' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('emits job.parse.failed to listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.parse.failed', listener);
      sseCallbacks.onMessage({
        type: 'job.parse.failed',
        payload: { joblifecycleId: 'job-s4', error: 'parse error' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('emits job.route.failed to listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.route.failed', listener);
      sseCallbacks.onMessage({
        type: 'job.route.failed',
        payload: { joblifecycleId: 'job-s4', error: 'route error' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('adds processed ID for job.parse.failed in queue', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-s4-queue', company: 'S4Co', role: 'Engineer' },
      });
      sseCallbacks.onMessage({
        type: 'job.parse.failed',
        payload: { joblifecycleId: 'job-s4-queue', error: 'parse error' },
      });
      expect(reader.getQueueDepth()).toBe(1);
    });
  });

  describe('nextJob blocking', () => {
    beforeEach(async () => {
      await connect();
    });

    it('returns enqueued job immediately from FIFO queue', async () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-fifo', company: 'FIFOCo', role: 'Engineer' },
      });

      const job = await reader.nextJob();
      expect(job?._id).toBe('job-fifo');
      expect(job?.company).toBe('FIFOCo');
    });

    it('skips processed IDs and returns next unprocessed job', async () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-skip', company: 'SkipCo', role: 'Engineer' },
      });
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-keep', company: 'KeepCo', role: 'Engineer' },
      });

      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: 'job-skip' },
      });

      const job = await reader.nextJob();
      expect(job?._id).toBe('job-keep');
    });
  });

  describe('event listeners', () => {
    beforeEach(async () => {
      await connect();
    });

    it('emits event to registered listeners', () => {
      const listener = vi.fn();
      reader.addEventListener('job.generated', listener);

      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-ev', company: 'EvCo', role: 'Engineer' },
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'job.generated',
          data: expect.objectContaining({ joblifecycleId: 'job-ev' }),
        }),
      );
    });

    it('does not emit to removed listener', () => {
      const listener = vi.fn();
      reader.addEventListener('job.generated', listener);
      reader.removeEventListener('job.generated', listener);

      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'job-rem', company: 'RemCo', role: 'Engineer' },
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('handleSseEvent - each signal type emits to listener', () => {
    beforeEach(async () => {
      await connect();
    });

    it('job.generated emits', () => {
      const listener = vi.fn();
      reader.addEventListener('job.generated', listener);
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'sg-1', company: 'Co', role: 'Engineer' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('job.parse.completed emits', () => {
      const listener = vi.fn();
      reader.addEventListener('job.parse.completed', listener);
      sseCallbacks.onMessage({
        type: 'job.parse.completed',
        payload: { joblifecycleId: 'sg-2', matchScore: 85 },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('job.route.queued emits', () => {
      const listener = vi.fn();
      reader.addEventListener('job.route.queued', listener);
      sseCallbacks.onMessage({
        type: 'job.route.queued',
        payload: { joblifecycleId: 'sg-3a' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('job.route.trashed emits', () => {
      const listener = vi.fn();
      reader.addEventListener('job.route.trashed', listener);
      sseCallbacks.onMessage({
        type: 'job.route.trashed',
        payload: { joblifecycleId: 'sg-3b' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('job.parse.failed emits', () => {
      const listener = vi.fn();
      reader.addEventListener('job.parse.failed', listener);
      sseCallbacks.onMessage({
        type: 'job.parse.failed',
        payload: { joblifecycleId: 'sg-4', error: 'parse error' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('job.route.failed emits', () => {
      const listener = vi.fn();
      reader.addEventListener('job.route.failed', listener);
      sseCallbacks.onMessage({
        type: 'job.route.failed',
        payload: { joblifecycleId: 'sg-4', error: 'route error' },
      });
      expect(listener).toHaveBeenCalled();
    });

    it('job.parse.failed adds processed ID and does not re-queue', () => {
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'sg-fail', company: 'FailCo', role: 'Engineer' },
      });
      sseCallbacks.onMessage({
        type: 'job.parse.failed',
        payload: { joblifecycleId: 'sg-fail', error: 'parse error' },
      });
      sseCallbacks.onMessage({
        type: 'job.generated',
        payload: { joblifecycleId: 'sg-fail', company: 'FailCo', role: 'Engineer' },
      });
      expect(reader.getQueueDepth()).toBe(1);
    });
  });
});
