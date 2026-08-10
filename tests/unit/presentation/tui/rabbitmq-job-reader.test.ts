import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';

function makeMockChannel() {
  return {
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue(undefined),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

const mockS1 = makeMockChannel();
const mockS2 = makeMockChannel();
const mockS34 = makeMockChannel();

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockImplementation(() =>
      Promise.resolve({
        createChannel: vi
          .fn()
          .mockResolvedValueOnce(mockS1)
          .mockResolvedValueOnce(mockS2)
          .mockResolvedValueOnce(mockS34),
      })
    ),
  },
}));

let currentJob: { jobLifecycleId: string | null; job: any; stage: string | null } = {
  jobLifecycleId: null,
  job: null,
  stage: null,
};
let queueMode = true;

vi.mock('../../../../src/presentation/tui/shared-tui-state.js', () => ({
  setCurrentJob: vi.fn((id: string, job: any, stage: string) => {
    currentJob = { jobLifecycleId: id, job, stage };
  }),
  clearCurrentJob: vi.fn(() => {
    currentJob = { jobLifecycleId: null, job: null, stage: null };
  }),
  getCurrentJob: vi.fn(() => currentJob),
  getQueueMode: vi.fn(() => queueMode),
}));

function makeS1Msg(id: string, overrides: Record<string, unknown> = {}) {
  return {
    content: Buffer.from(
      JSON.stringify({ _id: id, jobLifecycleId: id, company: 'TestCo', ...overrides })
    ),
    fields: { deliveryTag: 1, routingKey: 'job.generated' },
  };
}
function makeS2Msg(id: string, overrides: Record<string, unknown> = {}) {
  return {
    content: Buffer.from(
      JSON.stringify({
        _id: id,
        jobLifecycleId: id,
        role: 'Engineer',
        company: 'TestCo',
        ...overrides,
      })
    ),
    fields: { deliveryTag: 2, routingKey: 'job.parse.completed' },
  };
}
function makeS34Msg(id: string, routingKey: string) {
  return {
    content: Buffer.from(JSON.stringify(id)),
    fields: { deliveryTag: 3, routingKey },
  };
}

describe('RabbitMqJobReader', () => {
  let reader: import('../../../../src/presentation/tui/components/RabbitMqJobReader.js').RabbitMqJobReader;

  beforeEach(async () => {
    vi.clearAllMocks();
    currentJob = { jobLifecycleId: null, job: null, stage: null };
    queueMode = true;
    const { RabbitMqJobReader } =
      await import('../../../../src/presentation/tui/components/RabbitMqJobReader.js');
    reader = new RabbitMqJobReader('amqp://localhost');
    await reader.start();
  });

  afterEach(() => {
    reader.stop();
  });

  describe('start / stop', () => {
    it('connects and consumes 3 queues', () => {
      expect(mockS1.consume).toHaveBeenCalledWith('tui.s1', expect.any(Function));
      expect(mockS2.consume).toHaveBeenCalledWith('tui.s2', expect.any(Function));
      expect(mockS34.consume).toHaveBeenCalledWith('tui.s3s4', expect.any(Function));
      expect(reader.isConnected()).toBe(true);
    });

    it('stop clears connection state', () => {
      reader.stop();
      expect(reader.isConnected()).toBe(false);
    });
  });

  describe('S1 — job.generated', () => {
    it('auto-advances when idle', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      expect(reader.getQueueDepth()).toBe(0);
      expect(currentJob.jobLifecycleId).toBe('job-1');
      expect(currentJob.stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('stores delivery tag without immediate ack', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      expect(mockS1.ack).not.toHaveBeenCalled();
    });

    it('queues when another job is displayed', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      (reader as any).onMessageS1(makeS1Msg('job-2'));
      expect(reader.getQueueDepth()).toBe(1);
      expect(currentJob.jobLifecycleId).toBe('job-1');
    });
  });

  describe('S2 — job.parse.completed', () => {
    it('merges into displayed job and upgrades stage', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      (reader as any).onMessageS2(makeS2Msg('job-1'));
      expect(currentJob.stage).toBe(JobStage.FULL_PARSED);
    });

    it('F3: defers S2 when S1 not yet arrived', () => {
      (reader as any).onMessageS2(makeS2Msg('job-early'));
      expect(reader.getQueueDepth()).toBe(0);
      expect(currentJob.jobLifecycleId).toBeNull();
    });

    it('F3: drains deferred S2 when S1 arrives', () => {
      (reader as any).onMessageS2(makeS2Msg('job-early'));
      (reader as any).onMessageS1(makeS1Msg('job-early'));
      expect(currentJob.stage).toBe(JobStage.FULL_PARSED);
    });

    it('F5: direct mode sets immediately', () => {
      queueMode = false;
      (reader as any).onMessageS2(makeS2Msg('job-d'));
      expect(currentJob.jobLifecycleId).toBe('job-d');
      expect(currentJob.stage).toBe(JobStage.FULL_PARSED);
    });

    it('F5: rapid [i]x2 in direct mode replaces first', () => {
      queueMode = false;
      (reader as any).onMessageS2(makeS2Msg('job-1'));
      expect(currentJob.jobLifecycleId).toBe('job-1');
      (reader as any).onMessageS2(makeS2Msg('job-2'));
      expect(currentJob.jobLifecycleId).toBe('job-2');
    });
  });

  describe('S3/S4 — terminal events', () => {
    it('F6: S3 in queue mode advances to next', () => {
      (reader as any).onMessageS1(makeS1Msg('job-a'));
      (reader as any).onMessageS1(makeS1Msg('job-b'));
      (reader as any).onMessageS3S4(makeS34Msg('job-a', 'job.queue'));
      expect(reader.getQueueDepth()).toBe(0);
      expect(currentJob.jobLifecycleId).toBe('job-b');
    });

    it('F6: S4 in direct mode clears without advance', () => {
      queueMode = false;
      (reader as any).onMessageS2(makeS2Msg('job-x'));
      (reader as any).onMessageS3S4(makeS34Msg('job-x', 'job.trash'));
      expect(currentJob.jobLifecycleId).toBeNull();
    });

    it('acks S34 on S3 event', () => {
      (reader as any).onMessageS1(makeS1Msg('job-tag'));
      vi.clearAllMocks();
      (reader as any).onMessageS3S4(makeS34Msg('job-tag', 'job.queue'));
      expect(mockS34.ack).toHaveBeenCalled();
    });
  });

  describe('queue depth', () => {
    it('tracks pending backlog', () => {
      (reader as any).onMessageS1(makeS1Msg('j1'));
      (reader as any).onMessageS1(makeS1Msg('j2'));
      expect(reader.getQueueDepth()).toBe(1);
      (reader as any).onMessageS1(makeS1Msg('j3'));
      expect(reader.getQueueDepth()).toBe(2);
      (reader as any).onMessageS3S4(makeS34Msg('j1', 'job.queue'));
      expect(reader.getQueueDepth()).toBe(1);
    });
  });

  describe('budget contracts (PRC-008)', () => {
    it('applies prefetch=5 on every channel', () => {
      expect(mockS1.prefetch).toHaveBeenCalledWith(5);
      expect(mockS2.prefetch).toHaveBeenCalledWith(5);
      expect(mockS34.prefetch).toHaveBeenCalledWith(5);
    });

    it('DEFERRED_S2_MAX=10: nacks requeue=true when the deferred S2 buffer is full', () => {
      vi.clearAllMocks();
      for (let i = 0; i < 10; i++) {
        (reader as any).onMessageS2(makeS2Msg(`early-${i}`));
      }
      expect(mockS2.nack).not.toHaveBeenCalled();
      (reader as any).onMessageS2(makeS2Msg('early-11'));
      expect(mockS2.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    });

    it('DEFERRED_S2_TTL=30s: evicts stale deferred S2 with requeue=false', () => {
      vi.clearAllMocks();
      (reader as any).onMessageS2(makeS2Msg('early-stale'));
      (reader as any).deferredS2Buffer.set('early-stale', {
        payload: { _id: 'early-stale', role: 'Engineer', company: 'TestCo' },
        deliveryTag: 2,
        timestamp: Date.now() - 31_000,
      });
      (reader as any).evictStaleDeferred();
      expect(mockS2.nack).toHaveBeenCalledWith(expect.anything(), false, false);
      expect((reader as any).deferredS2Buffer.has('early-stale')).toBe(false);
    });
  });
});
