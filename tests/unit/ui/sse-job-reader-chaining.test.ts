import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStartSseClient = vi.fn();
let sseCallbacks: any;

vi.mock('../../../src/ui/sse-client.js', () => ({
  default: mockStartSseClient,
}));

const { SseJobReader } = await import('../../../src/presentation/tui/components/SseJobReader.js' );

describe('SseJobReader S1→S2 chaining edge cases', () => {
  let reader: InstanceType<typeof SseJobReader>;

  beforeEach(() => {
    mockStartSseClient.mockReset();
    sseCallbacks = null as any;
    mockStartSseClient.mockImplementation((_baseUrl: string, _token: string | undefined, opts: any) => {
      sseCallbacks = opts;
      return { close: vi.fn() };
    });
    reader = new SseJobReader('http://localhost:3000', 'test-token');
    const p = reader.connect();
    sseCallbacks.onOpen();
    return p;
  });

  function emit(type: string, payload: any) {
    sseCallbacks.onMessage({ type, payload });
  }

  it('S2 merges into queued S1 when S1 is not at front of queue', () => {
    emit('job.generated', { joblifecycleId: 'job-front', company: 'FrontCo', role: 'Front' });
    emit('job.generated', { joblifecycleId: 'job-back', company: 'BackCo', role: 'Back' });

    emit('job.parse.completed', { joblifecycleId: 'job-back', role: 'Back Updated', salary: '$100k' });

    const front = reader.peekNextJob();
    expect(front?._id).toBe('job-front');
    expect(front?.role).toBe('Front');

    reader.nextJob().then(() => {});
    const back = reader.peekNextJob();
    expect(back?._id).toBe('job-back');
    expect(back?.role).toBe('Back Updated');
    expect(back?.salary).toBe('$100k');
  });

  it('S2 emits to live listener when job already dequeued', async () => {
    emit('job.generated', { joblifecycleId: 'job-deq', company: 'DeqCo', role: 'Engineer' });

    const dequeued = await reader.nextJob();
    expect(dequeued?._id).toBe('job-deq');

    const listener = vi.fn();
    reader.addEventListener('job.parse.completed', listener);

    emit('job.parse.completed', { joblifecycleId: 'job-deq', role: 'Senior', matchScore: 90 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'job.parse.completed',
        data: expect.objectContaining({ joblifecycleId: 'job-deq' }),
      }),
    );
  });

  it('S2 for unknown joblifecycleId emits to listener without matching queue', () => {
    emit('job.generated', { joblifecycleId: 'job-existing', company: 'Co', role: 'Engineer' });

    const listener = vi.fn();
    reader.addEventListener('job.parse.completed', listener);

    emit('job.parse.completed', { joblifecycleId: 'unknown-job', role: 'Ghost' });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('multiple S2 events for same queued job all merge', () => {
    emit('job.generated', { joblifecycleId: 'job-merge', company: 'Co', role: 'Engineer' });

    emit('job.parse.completed', { joblifecycleId: 'job-merge', matchScore: 50 });
    emit('job.parse.completed', { joblifecycleId: 'job-merge', matchScore: 95, salary: '$120k' });

    const job = reader.peekNextJob();
    expect(job?.matchScore).toBe(95);
    expect(job?.salary).toBe('$120k');
  });

  it('S2 merge does not prevent subsequent S3 from clearing processed ID', async () => {
    emit('job.generated', { joblifecycleId: 'job-flow', company: 'Co', role: 'Engineer' });
    emit('job.parse.completed', { joblifecycleId: 'job-flow', matchScore: 85 });
    emit('job.generated', { joblifecycleId: 'job-next', company: 'NextCo', role: 'Dev' });

    emit('job.route.queued', { joblifecycleId: 'job-flow' });

    const first = await reader.nextJob();
    expect(first?._id).toBe('job-next');
    expect(reader.getQueueDepth()).toBe(0);
  });

  it('S2 with no joblifecycleId does not crash', () => {
    expect(() => {
      emit('job.parse.completed', { matchScore: 85 });
    }).not.toThrow();
  });
});
