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
const mockS2queue = makeMockChannel();
const mockS2direct = makeMockChannel();
const mockS34 = makeMockChannel();

vi.mock('amqplib', () => ({
  default: {
    connect: vi.fn().mockImplementation(() =>
      Promise.resolve({
        createChannel: vi
          .fn()
          .mockResolvedValueOnce(mockS1)
          .mockResolvedValueOnce(mockS2queue)
          .mockResolvedValueOnce(mockS2direct)
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
    it('GIVEN RabbitMqJobReader WHEN reader.isConnected THEN connects and consumes 4 queues', () => {
      expect(mockS1.consume).toHaveBeenCalledWith('tui.s1', expect.any(Function));
      expect(mockS2queue.consume).toHaveBeenCalledWith('tui.s2', expect.any(Function));
      expect(mockS2direct.consume).toHaveBeenCalledWith('tui.s2direct', expect.any(Function));
      expect(mockS34.consume).toHaveBeenCalledWith('tui.s3s4', expect.any(Function));
      expect(reader.isConnected()).toBe(true);
    });

    it('GIVEN RabbitMqJobReader WHEN reader.stop THEN stop clears connection state', () => {
      reader.stop();
      expect(reader.isConnected()).toBe(false);
    });
  });

  describe('S1 — job.generated', () => {
    it('GIVEN idle WHEN reader.getQueueDepth THEN auto-advances (S1)', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      expect(reader.getQueueDepth()).toBe(0);
      expect(currentJob.jobLifecycleId).toBe('job-1');
      expect(currentJob.stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('GIVEN RabbitMqJobReader WHEN exercised THEN stores delivery tag without immediate ack', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      expect(mockS1.ack).not.toHaveBeenCalled();
    });

    it('GIVEN another job is displayed WHEN reader.getQueueDepth THEN queues', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      (reader as any).onMessageS1(makeS1Msg('job-2'));
      expect(reader.getQueueDepth()).toBe(1);
      expect(currentJob.jobLifecycleId).toBe('job-1');
    });
  });

  describe('S2 — job.parse.completed — QUEUE mode (S1-then-S2 / [c] enrichment) — 4 queues s2queue', () => {
    it('GIVEN RabbitMqJobReader WHEN exercised THEN merges into displayed job and upgrades stage (S2)', () => {
      (reader as any).onMessageS1(makeS1Msg('job-1'));
      (reader as any).onMessageS2Queue(makeS2Msg('job-1'));
      expect(currentJob.stage).toBe(JobStage.FULL_PARSED);
    });

    it('GIVEN S1 not yet arrived WHEN reader.getQueueDepth THEN F3: defers S2', () => {
      (reader as any).onMessageS2Queue(makeS2Msg('job-early'));
      expect(reader.getQueueDepth()).toBe(0);
      expect(currentJob.jobLifecycleId).toBeNull();
    });

    it('GIVEN S1 arrives WHEN exercised THEN F3: drains deferred S2 (S2)', () => {
      (reader as any).onMessageS2Queue(makeS2Msg('job-early'));
      (reader as any).onMessageS1(makeS1Msg('job-early'));
      expect(currentJob.stage).toBe(JobStage.FULL_PARSED);
    });

    it('GIVEN s2 before s1 ordering WHEN exercised THEN deferred S2 drains then acks exactly once via S34 (no double-ack)', () => {
      vi.clearAllMocks();
      (reader as any).onMessageS2Queue(makeS2Msg('job-early'));
      const tagId = String((reader as any).deliveryTagsS2Queue.keys().next().value);
      expect(tagId).toBe('job-early');
      (reader as any).onMessageS1(makeS1Msg('job-early'));
      expect((reader as any).deferredS2QueueBuffer.has('job-early')).toBe(false);
      (reader as any).onMessageS3S4(makeS34Msg('job-early', 'job.queue'));
      expect(mockS2queue.ack).toHaveBeenCalledWith(
        expect.objectContaining({ fields: { deliveryTag: 2 } }),
        false
      );
      expect((reader as any).deliveryTagsS2Queue.has('job-early')).toBe(false);
      expect(mockS2queue.ack).toHaveBeenCalledTimes(1);
    });
  });

  describe('S2 — job.parse.completed — DIRECT mode ([i], no S1) — 4 queues s2direct prefetch 1 ack in s34', () => {
    it('GIVEN RabbitMqJobReader WHEN exercised THEN F5: direct mode sets immediately (S2)', () => {
      queueMode = false;
      (reader as any).onMessageS2Direct(makeS2Msg('job-d'));
      expect(currentJob.jobLifecycleId).toBe('job-d');
      expect(currentJob.stage).toBe(JobStage.FULL_PARSED);
    });

    it('GIVEN RabbitMqJobReader WHEN exercised THEN F5: rapid [i]x2 in direct mode replaces first', () => {
      queueMode = false;
      (reader as any).onMessageS2Direct(makeS2Msg('job-1'));
      expect(currentJob.jobLifecycleId).toBe('job-1');
      (reader as any).onMessageS2Direct(makeS2Msg('job-2'));
      expect(currentJob.jobLifecycleId).toBe('job-2');
    });

    it('GIVEN RabbitMqJobReader WHEN exercised THEN direct mode records tag and defers ack to s34 (prefetch 1)', () => {
      queueMode = false;
      vi.clearAllMocks();
      (reader as any).onMessageS2Direct(makeS2Msg('job-d-ack'));
      expect(mockS2direct.ack).toHaveBeenCalledTimes(0);
      expect((reader as any).deliveryTagsS2Direct.size).toBe(1);
      expect((reader as any).deferredS2QueueBuffer.size).toBe(0);
      (reader as any).onMessageS3S4(makeS34Msg('job-d-ack', 'job.queue'));
      expect(mockS2direct.ack).toHaveBeenCalledTimes(1);
      expect((reader as any).deliveryTagsS2Direct.size).toBe(0);
    });
  });

  describe('S3/S4 — terminal events', () => {
    it('GIVEN RabbitMqJobReader WHEN reader.getQueueDepth THEN F6: S3 in queue mode advances to next (S3)', () => {
      (reader as any).onMessageS1(makeS1Msg('job-a'));
      (reader as any).onMessageS1(makeS1Msg('job-b'));
      (reader as any).onMessageS3S4(makeS34Msg('job-a', 'job.queue'));
      expect(reader.getQueueDepth()).toBe(0);
      expect(currentJob.jobLifecycleId).toBe('job-b');
    });

    it('GIVEN RabbitMqJobReader WHEN exercised THEN F6: S4 in direct mode clears without advance (S4)', () => {
      queueMode = false;
      (reader as any).onMessageS2Direct(makeS2Msg('job-x'));
      (reader as any).onMessageS3S4(makeS34Msg('job-x', 'job.trash'));
      expect(currentJob.jobLifecycleId).toBeNull();
    });

    it('GIVEN RabbitMqJobReader WHEN vi.clearAllMocks THEN acks S34 on S3 event (S3)', () => {
      (reader as any).onMessageS1(makeS1Msg('job-tag'));
      vi.clearAllMocks();
      (reader as any).onMessageS3S4(makeS34Msg('job-tag', 'job.queue'));
      expect(mockS34.ack).toHaveBeenCalled();
    });

    it('GIVEN a deferred-only S2 WHEN its S3 resolves THEN the S2 tag is acked once and a later evict never re-nacks', () => {
      vi.clearAllMocks();
      (reader as any).onMessageS2Queue(makeS2Msg('job-donly'));
      (reader as any).deferredS2QueueBuffer.set('job-donly', {
        payload: { _id: 'job-donly', role: 'Engineer', company: 'TestCo' },
        deliveryTag: 2,
        timestamp: Date.now() - 31_000,
      });
      (reader as any).onMessageS3S4(makeS34Msg('job-donly', 'job.queue'));
      expect(mockS2queue.ack).toHaveBeenCalledWith(
        expect.objectContaining({ fields: { deliveryTag: 2 } }),
        false
      );
      expect(mockS2queue.ack).toHaveBeenCalledTimes(1);
      expect((reader as any).deliveryTagsS2Queue.has('job-donly')).toBe(false);
      vi.clearAllMocks();
      (reader as any).evictStaleDeferred();
      expect(mockS2queue.nack).toHaveBeenCalledTimes(0);
      expect((reader as any).deferredS2QueueBuffer.has('job-donly')).toBe(false);
    });

    it('GIVEN a direct-mode job WHEN its S3 resolves THEN s2direct and s34 are acked (no S1/s2queue ack)', () => {
      queueMode = false;
      (reader as any).onMessageS2Direct(makeS2Msg('job-d'));
      vi.clearAllMocks();
      (reader as any).onMessageS3S4(makeS34Msg('job-d', 'job.queue'));
      expect(mockS2direct.ack).toHaveBeenCalledTimes(1);
      expect(mockS2queue.ack).toHaveBeenCalledTimes(0);
      expect(mockS1.ack).toHaveBeenCalledTimes(0);
      expect(mockS34.ack).toHaveBeenCalledTimes(1);
      expect(currentJob.jobLifecycleId).toBeNull();
    });
  });

  describe('queue depth', () => {
    it('GIVEN RabbitMqJobReader WHEN reader.getQueueDepth THEN tracks pending backlog (S3)', () => {
      (reader as any).onMessageS1(makeS1Msg('j1'));
      (reader as any).onMessageS1(makeS1Msg('j2'));
      expect(reader.getQueueDepth()).toBe(1);
      (reader as any).onMessageS1(makeS1Msg('j3'));
      expect(reader.getQueueDepth()).toBe(2);
      (reader as any).onMessageS3S4(makeS34Msg('j1', 'job.queue'));
      expect(reader.getQueueDepth()).toBe(1);
    });
  });

  describe('budget contracts (PRC-008) — 4 queues', () => {
    it('GIVEN RabbitMqJobReader WHEN exercised THEN applies prefetch s1 5 s2queue 5 s34 5 s2direct 1', () => {
      expect(mockS1.prefetch).toHaveBeenCalledWith(5);
      expect(mockS2queue.prefetch).toHaveBeenCalledWith(5);
      expect(mockS2direct.prefetch).toHaveBeenCalledWith(1);
      expect(mockS34.prefetch).toHaveBeenCalledWith(5);
    });

    it('GIVEN the deferred S2 buffer is full WHEN vi.clearAllMocks THEN DEFERRED_S2_MAX=10: nacks requeue=true', () => {
      vi.clearAllMocks();
      for (let i = 0; i < 10; i++) {
        (reader as any).onMessageS2Queue(makeS2Msg(`early-${i}`));
      }
      expect(mockS2queue.nack).not.toHaveBeenCalled();
      (reader as any).onMessageS2Queue(makeS2Msg('early-11'));
      expect(mockS2queue.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    });

    it('GIVEN RabbitMqJobReader WHEN vi.clearAllMocks THEN DEFERRED_S2_TTL=30s: evicts stale deferred S2 with requeue=false', () => {
      vi.clearAllMocks();
      (reader as any).onMessageS2Queue(makeS2Msg('early-stale'));
      (reader as any).deferredS2QueueBuffer.set('early-stale', {
        payload: { _id: 'early-stale', role: 'Engineer', company: 'TestCo' },
        deliveryTag: 2,
        timestamp: Date.now() - 31_000,
      });
      (reader as any).evictStaleDeferred();
      expect(mockS2queue.nack).toHaveBeenCalledWith(expect.anything(), false, false);
      expect((reader as any).deferredS2QueueBuffer.has('early-stale')).toBe(false);
    });

    it('GIVEN RabbitMqJobReader WHEN vi.clearAllMocks THEN evict removes the nacked tag from deliveryTagsS2Queue (no re-ack by dead tag)', () => {
      vi.clearAllMocks();
      (reader as any).onMessageS2Queue(makeS2Msg('early-stale'));
      (reader as any).deferredS2QueueBuffer.set('early-stale', {
        payload: { _id: 'early-stale', role: 'Engineer', company: 'TestCo' },
        deliveryTag: 2,
        timestamp: Date.now() - 31_000,
      });
      (reader as any).evictStaleDeferred();
      expect((reader as any).deliveryTagsS2Queue.has('early-stale')).toBe(false);
      (reader as any).onMessageS3S4(makeS34Msg('early-stale', 'job.queue'));
      expect(mockS2queue.ack).toHaveBeenCalledTimes(0);
    });

    it('GIVEN a deferred S2 already resolved by S3 WHEN evict runs THEN stale entry is dropped with no nack', () => {
      vi.clearAllMocks();
      (reader as any).onMessageS2Queue(makeS2Msg('early-resolved'));
      (reader as any).deferredS2QueueBuffer.set('early-resolved', {
        payload: { _id: 'early-resolved', role: 'Engineer', company: 'TestCo' },
        deliveryTag: 2,
        timestamp: Date.now() - 31_000,
      });
      (reader as any).onMessageS3S4(makeS34Msg('early-resolved', 'job.queue'));
      vi.clearAllMocks();
      (reader as any).evictStaleDeferred();
      expect(mockS2queue.nack).toHaveBeenCalledTimes(0);
      expect((reader as any).deferredS2QueueBuffer.has('early-resolved')).toBe(false);
    });
  });
});
