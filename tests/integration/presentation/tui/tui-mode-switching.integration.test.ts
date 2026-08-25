import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import amqplib, { type Channel } from 'amqplib';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import { JobStage } from '../../../../src/domain/types/job-lifecycle.js';
import { RabbitMqJobReader } from '../../../../src/presentation/tui/components/RabbitMqJobReader.js';
import {
  setQueueMode,
  getQueueMode,
  getCurrentJob,
  setCurrentJob,
  clearCurrentJob,
  resetState,
} from '../../../../src/presentation/tui/shared-tui-state.js';
import { waitFor } from '../../../helpers/test-utils.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

// Private per-run topology so the reader does NOT consume the global
// `jobs.events` firehose that parallel integration files publish into (which
// inflated pendingJobs and made exact depth/current assertions timing-dependent).
const TOKEN = `${process.pid}.${Date.now()}`;
const EXCHANGE = `jobs.events.tui.itest.${TOKEN}`;
const S1_QUEUE = `tui.itest.${TOKEN}.s1`;
const S2QUEUE = `tui.itest.${TOKEN}.s2`;
const S2DIRECT = `tui.itest.${TOKEN}.s2direct`;
const S34_QUEUE = `tui.itest.${TOKEN}.s3s4`;
const READER_OPTS = {
  exchange: EXCHANGE,
  s1Queue: S1_QUEUE,
  s2Queue: S2QUEUE,
  s2DirectQueue: S2DIRECT,
  s34Queue: S34_QUEUE,
};

// Isolate shared-state to a temp dir so tests don't collide with real TUI state.
const sharedStateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-mode-'));
process.env.TUI_SHARED_STATE_PATH = path.join(sharedStateDir, 'tui-state.json');

function publish(ch: Channel, key: string, payload: unknown): void {
  ch.publish(EXCHANGE, key, Buffer.from(JSON.stringify(payload)), { persistent: true });
}

describe('PRC-005 — TUI mode switching ([b] queue/direct, [c]/[i] chain)', () => {
  let conn: Awaited<ReturnType<typeof amqplib.connect>>;
  let ch: Channel;

  beforeAll(async () => {
    conn = await amqplib.connect(RMQ_URL);
    ch = await conn.createChannel();
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(S1_QUEUE, { durable: true });
    await ch.assertQueue(S2QUEUE, { durable: true });
    await ch.assertQueue(S2DIRECT, { durable: true });
    await ch.assertQueue(S34_QUEUE, { durable: true });
    await ch.bindQueue(S1_QUEUE, EXCHANGE, ActionEvent.GENERATED);
    await ch.bindQueue(S2QUEUE, EXCHANGE, ActionEvent.PARSE_COMPLETED);
    await ch.bindQueue(S2DIRECT, EXCHANGE, ActionEvent.PARSE_COMPLETED);
    await ch.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.QUEUED);
    await ch.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.TRASHED);
    await ch.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.ROUTE_FAILED);
    await ch.bindQueue(S34_QUEUE, EXCHANGE, ActionEvent.PARSE_FAILED);
    resetState();
  }, 30000);

  beforeEach(async () => {
    try {
      await ch.purgeQueue(S1_QUEUE);
    } catch {}
    try {
      await ch.purgeQueue(S2QUEUE);
    } catch {}
    try {
      await ch.purgeQueue(S2DIRECT);
    } catch {}
    try {
      await ch.purgeQueue(S34_QUEUE);
    } catch {}
    resetState();
  });

  afterAll(async () => {
    try {
      await ch.purgeQueue(S1_QUEUE);
    } catch {}
    try {
      await ch.purgeQueue(S2QUEUE);
    } catch {}
    try {
      await ch.purgeQueue(S2DIRECT);
    } catch {}
    try {
      await ch.purgeQueue(S34_QUEUE);
    } catch {}
    await ch.close();
    await conn.close();
    fs.rmSync(sharedStateDir, { recursive: true, force: true });
  });

  it('GIVEN PRC WHEN exercised THEN [b] default mode is queue mode (true)', () => {
    expect(getQueueMode()).toBe(true);
  });

  it('GIVEN PRC WHEN exercised THEN [b] toggle queue → direct → queue via setQueueMode', () => {
    setQueueMode(false);
    expect(getQueueMode()).toBe(false);
    setQueueMode(true);
    expect(getQueueMode()).toBe(true);
  });

  it('GIVEN PRC WHEN exercised THEN [b] direct mode [i]-style setCurrentJob latest-wins (overwrites previous) (S2)', () => {
    setQueueMode(false);
    setCurrentJob(
      'direct-job-1',
      { role: 'First', company: 'FirstCo' } as any,
      JobStage.FULL_PARSED
    );
    setCurrentJob(
      'direct-job-2',
      { role: 'Second', company: 'SecondCo' } as any,
      JobStage.FULL_PARSED
    );

    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBe('direct-job-2');
    expect(cur.job?.company).toBe('SecondCo');
  });

  it('GIVEN PRC WHEN exercised THEN [b] queue mode setCurrentJob rejects overwrite of different displayed job (S1)', () => {
    setQueueMode(true);
    setCurrentJob('queue-job-1', { role: 'A', company: 'ACo' } as any, JobStage.PARTIAL_PARSED);
    setCurrentJob('queue-job-2', { role: 'B', company: 'BCo' } as any, JobStage.PARTIAL_PARSED);

    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBe('queue-job-1');
    expect(cur.job?.company).toBe('ACo');
  });

  it('GIVEN PRC WHEN exercised THEN [c] chain: s1 (GENERATED) then s2 (PARSE_COMPLETED) merges into pending → advances', async () => {
    const reader = new RabbitMqJobReader(RMQ_URL, READER_OPTS);
    await reader.start();
    await new Promise((r) => setTimeout(r, 300));

    publish(ch, ActionEvent.GENERATED, {
      _id: 'chain-1',
      role: 'Software Engineer',
      company: 'ChainCo',
      stage: JobStage.PARTIAL_PARSED,
    });
    await new Promise((r) => setTimeout(r, 400));
    publish(ch, ActionEvent.PARSE_COMPLETED, {
      _id: 'chain-1',
      role: 'Software Engineer',
      company: 'ChainCo',
      description: 'full desc',
      stage: JobStage.FULL_PARSED,
    });

    await new Promise((r) => setTimeout(r, 500));
    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBe('chain-1');
    expect(cur.job?.description).toBe('full desc');
    reader.stop();
  }, 20000);

  it('GIVEN PRC WHEN exercised THEN [i] direct-mode standalone PARSE_COMPLETED sets current job', async () => {
    const reader = new RabbitMqJobReader(RMQ_URL, READER_OPTS);
    await reader.start();
    await new Promise((r) => setTimeout(r, 300));
    setQueueMode(false);

    publish(ch, ActionEvent.PARSE_COMPLETED, {
      _id: 'direct-chain-1',
      role: 'Backend Developer',
      company: 'DirectCo',
      stage: JobStage.FULL_PARSED,
    });

    await new Promise((r) => setTimeout(r, 500));
    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBe('direct-chain-1');
    expect(cur.stage).toBe(JobStage.FULL_PARSED);
    reader.stop();
  }, 20000);

  it('GIVEN PRC WHEN exercised THEN s3s4 completion (QUEUED) removes job from pending and clears current', async () => {
    const reader = new RabbitMqJobReader(RMQ_URL, READER_OPTS);
    await reader.start();
    await new Promise((r) => setTimeout(r, 300));

    publish(ch, ActionEvent.GENERATED, {
      _id: 'complete-1',
      role: 'Data Engineer',
      company: 'DoneCo',
      stage: JobStage.PARTIAL_PARSED,
    });
    publish(ch, ActionEvent.PARSE_COMPLETED, {
      _id: 'complete-1',
      role: 'Data Engineer',
      company: 'DoneCo',
      stage: JobStage.FULL_PARSED,
    });
    await waitFor(() => getCurrentJob().jobLifecycleId === 'complete-1');

    publish(ch, ActionEvent.QUEUED, 'complete-1');
    await waitFor(() => getCurrentJob().jobLifecycleId === null);

    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBeNull();
    reader.stop();
  }, 20000);

  it('GIVEN PRC WHEN exercised THEN s4 (PARSE_FAILED) clears current job and advances', async () => {
    const reader = new RabbitMqJobReader(RMQ_URL, READER_OPTS);
    await reader.start();
    await new Promise((r) => setTimeout(r, 300));

    publish(ch, ActionEvent.GENERATED, {
      _id: 'fail-adv-1',
      role: 'Web Developer',
      company: 'FailCo',
      stage: JobStage.PARTIAL_PARSED,
    });
    await waitFor(() => getCurrentJob().jobLifecycleId === 'fail-adv-1');

    publish(ch, ActionEvent.PARSE_FAILED, 'fail-adv-1');
    await waitFor(() => getCurrentJob().jobLifecycleId === null);

    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBeNull();
    reader.stop();
  }, 20000);

  it('GIVEN PRC WHEN exercised THEN reader stays connected after start (isConnected)', async () => {
    const reader = new RabbitMqJobReader(RMQ_URL, READER_OPTS);
    await reader.start();
    await new Promise((r) => setTimeout(r, 300));
    expect(reader.isConnected()).toBe(true);
    reader.stop();
    await new Promise((r) => setTimeout(r, 200));
  }, 20000);

  it('GIVEN PRC WHEN exercised THEN multiple s1 jobs queue up in pending and auto-advance sequentially', async () => {
    const reader = new RabbitMqJobReader(RMQ_URL, READER_OPTS);
    await reader.start();
    await new Promise((r) => setTimeout(r, 300));

    publish(ch, ActionEvent.GENERATED, {
      _id: 'seq-1',
      role: 'Software Engineer',
      company: 'SeqCo1',
      stage: JobStage.PARTIAL_PARSED,
    });
    publish(ch, ActionEvent.GENERATED, {
      _id: 'seq-2',
      role: 'Backend Developer',
      company: 'SeqCo2',
      stage: JobStage.PARTIAL_PARSED,
    });
    publish(ch, ActionEvent.GENERATED, {
      _id: 'seq-3',
      role: 'Data Engineer',
      company: 'SeqCo3',
      stage: JobStage.PARTIAL_PARSED,
    });

    await waitFor(() => getCurrentJob().jobLifecycleId === 'seq-1');
    await waitFor(() => reader.getQueueDepth() === 2);
    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBe('seq-1');
    expect(reader.getQueueDepth()).toBe(2);
    reader.stop();
  }, 25000);

  it('GIVEN PRC WHEN exercised THEN clearCurrentJob resets active-mode substate (S2)', () => {
    setQueueMode(false);
    setCurrentJob(
      'clear-1',
      { role: 'Full Stack Developer', company: 'ClearCo' } as any,
      JobStage.FULL_PARSED
    );
    clearCurrentJob();
    const cur = getCurrentJob();
    expect(cur.jobLifecycleId).toBeNull();
    expect(cur.job).toBeNull();
  });
});
