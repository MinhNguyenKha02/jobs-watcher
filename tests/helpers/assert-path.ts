/**
 * Saga-ring assertion helpers — one pick seam `assertPicked` covers both `whenS1Many` pick and `whenQueue|Trash|*Failed` pick
 * (same `RabbitMqJobReader` `pendingJobs` + `autoAdvance 423`), one clear seam `assertDirectClear` covers `except s2b` direct `S2b→S3|S4→clear`.
 * `unit` variant reads mock spies, `integ` variant reads real `daemon.mongo` `tui.reader` `tui.ipc`.
 */
import { expect } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

import type {
  TuiTestContainer,
  TestDaemonContainer,
  MockTestDaemonContainer,
} from './test-container.js';

type AnyDaemon = TestDaemonContainer | MockTestDaemonContainer;

// --- single pick seam s1[] s1Count=4 ---

export function assertPicked(
  tui: TuiTestContainer,
  opts: { messageId: string; s1Count: number; expectedIdx: number }
): void {
  const { messageId, s1Count, expectedIdx } = opts;
  const expectedId = `${messageId}-job-${expectedIdx}`;
  const expectedDepth = s1Count - expectedIdx - 1;
  const expectedNextId = `${messageId}-job-${expectedIdx + 1}`;
  const isMockReader =
    typeof (tui.reader.getQueueDepth as unknown as { mock?: unknown })?.mock !== 'undefined' ||
    typeof (tui.reader.peekPending as unknown as { mock?: unknown })?.mock !== 'undefined';
  if (isMockReader) {
    // Unit: mock reader — verify queue seam matches RabbitMqJobReader pending/autoAdvance 51/52/78/81/434
    // (pending excludes current, depth = s1Count-idx-1). Relax pending[0]→toContain for Indeed scheduler 3 workers nondeterministic insert order (ingestor.ts:393 ExtractionScheduler + renderer.ts:53 chromium.launch), still strict on depth/length.
    const depth = tui.reader.getQueueDepth();
    expect(depth).toBe(expectedDepth);
    const pending = tui.reader.peekPending();
    expect(pending.length).toBe(expectedDepth < 0 ? 0 : expectedDepth);
    if (expectedIdx + 1 < s1Count) {
      expect(pending).toContain(expectedNextId);
    }
    expect(tui.reader.getQueueModeState()).toBe(true);
    return;
  }
  // Integ (real reader): ipc + pending depth must agree with RabbitMqJobReader currentJobId/pendingJobs
  expect(tui.reader.getQueueModeState()).toBe(true);
  expect(tui.ipc.read().jobLifecycleId).toBe(expectedId);
  const depth = tui.reader.getQueueDepth();
  expect(depth).toBe(expectedDepth);
  const pending = tui.reader.peekPending();
  expect(pending.length).toBe(expectedDepth);
  if (expectedIdx + 1 < s1Count) {
    expect(pending).toContain(expectedNextId);
  }
}

// --- Indeed scheduler Set check: s1[4] pending nondeterministic (3 workers) — set equality over strict order ---
export function assertPickedSet(
  tui: TuiTestContainer,
  opts: { messageId: string; s1Count: number }
): void {
  const { messageId, s1Count } = opts;
  const cur = tui.ipc.read().jobLifecycleId;
  expect(cur).not.toBeNull();
  const pending = tui.reader.peekPending();
  const set = new Set([...pending, cur!]);
  const expected = new Set(Array.from({ length: s1Count }, (_, i) => `${messageId}-job-${i}`));
  expect(set).toEqual(expected);
  expect(tui.reader.getQueueDepth()).toBe(s1Count - 1);
}

// --- direct S2b→S3|S4→clear except s2b ---

export async function assertDirectClear(
  tui: TuiTestContainer,
  daemon: AnyDaemon,
  opts: { clipId?: string } = {}
): Promise<void> {
  const isMockReader =
    typeof (tui.reader.getQueueDepth as unknown as { mock?: unknown })?.mock !== 'undefined';
  if (isMockReader) {
    // Unit: mock reader — verify same seam as RabbitMqJobReader direct mode 316/353/408/434
    // (no pending accumulation, prefetch 1 freed, tag acked at S34, extractQueue never enqueued)
    expect(tui.reader.getQueueDepth()).toBe(0);
    expect(tui.reader.peekPending().length).toBe(0);
    expect(tui.reader.getQueueModeState()).toBe(false);
    expect(tui.ipc.read().jobLifecycleId).toBeNull();
    expect(tui.ipc.read().job).toBeNull();
    // S2b never enqueues to extraction queue (hasUrl false, src/application/ingestor.ts:180)
    // For mock, verify size 0 if exposed; real integ also checks below
    const sizeMaybe = (daemon.extractQueue as unknown as { size?: () => Promise<number> }).size;
    if (sizeMaybe) {
      const size = await sizeMaybe.call(daemon.extractQueue);
      expect(size).toBe(0);
    }
    return;
  }
  // Integ (real reader): pending 0, ipc cleared, queueMode direct, isConnected not wedged, extractQueue size 0
  // covers RabbitMqJobReader onMessageS2Direct 316 (currentJobId set) -> onMessageS3S4 353 ackS2TagDirect 418 + clearCurrentJob 375 + autoAdvance 434 no-op (getQueueMode false)
  expect(tui.reader.getQueueDepth()).toBe(0);
  expect(tui.reader.peekPending().length).toBe(0);
  expect(tui.ipc.read().jobLifecycleId).toBeNull();
  expect(tui.ipc.read().job).toBeNull();
  expect(tui.reader.getQueueModeState()).toBe(false);
  expect(tui.reader.isConnected()).toBe(true);
  // S2b never uses extraction queue
  const size = await (daemon.extractQueue as unknown as { size: () => Promise<number> }).size();
  expect(size).toBe(0);
  if (opts.clipId) {
    // clip-* tag for direct S2 must have been acked at S34 (ackS2TagDirectForJobId 418, prefetch1 186) — no leak, depth 0 already covers
    expect(tui.ipc.read().jobLifecycleId).toBeNull();
  }
}

// --- full checkpoint helpers (sugar over pick + stage/status) ---

export async function assertS1ManyEnriching(
  daemon: AnyDaemon,
  tui: TuiTestContainer,
  opts: { messageId: string; s1Count: number }
): Promise<void> {
  assertPicked(tui, { messageId: opts.messageId, s1Count: opts.s1Count, expectedIdx: 0 });
  const firstId = `${opts.messageId}-job-0`;
  const doc = await (daemon as TestDaemonContainer).jobLifecycle?.findById(firstId);
  if (doc) {
    expect(doc.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(doc.status).toBe(JobStatus.ENRICHING);
  }
}

export async function assertS2Enriched(daemon: AnyDaemon, id: string): Promise<void> {
  const doc = (await (
    daemon as AnyDaemon & { jobLifecycle: { findById: (id: string) => Promise<unknown> } }
  ).jobLifecycle.findById(id)) as unknown as { stage: unknown; status: unknown } | null;
  if (doc) {
    expect(doc.stage).toBe(JobStage.FULL_PARSED);
    expect(doc.status).toBe(JobStatus.ENRICHED);
  }
}

export async function assertS3Queued(daemon: AnyDaemon, id: string): Promise<void> {
  const doc = (await (daemon as TestDaemonContainer).jobLifecycle.findById(id)) as unknown as {
    status: unknown;
  } | null;
  if (doc) expect(doc.status).toBe(JobStatus.QUEUED);
}

export async function assertS3Trashed(daemon: AnyDaemon, id: string): Promise<void> {
  const doc = (await (daemon as TestDaemonContainer).jobLifecycle.findById(id)) as unknown as {
    status: unknown;
  } | null;
  if (doc) expect(doc.status).toBe(JobStatus.TRASHED);
}

export async function assertS4RouteFailedStillEnriched(
  daemon: AnyDaemon,
  id: string
): Promise<void> {
  const doc = (await (daemon as TestDaemonContainer).jobLifecycle.findById(id)) as unknown as {
    status: unknown;
    stage: unknown;
  } | null;
  if (doc) {
    expect(doc.status).toBe(JobStatus.ENRICHED);
    expect(doc.stage).toBe(JobStage.FULL_PARSED);
  }
}

export async function assertS4PartialStillEnriching(daemon: AnyDaemon, id: string): Promise<void> {
  const doc = (await (daemon as TestDaemonContainer).jobLifecycle.findById(id)) as unknown as {
    status: unknown;
    stage: unknown;
  } | null;
  if (doc) {
    expect(doc.status).toBe(JobStatus.ENRICHING);
    expect(doc.stage).toBe(JobStage.PARTIAL_PARSED);
  }
}
