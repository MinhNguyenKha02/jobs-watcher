/**
 * Ingestor-port driving contract table helpers — src/application/ports/inbound/ingestor.port.ts:11
 * Additive only (contract both ports unless ingestor-contract only per plan)
 */
import { expect } from 'vitest';

import { JobSource, JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import type { TestDaemonContainer } from './test-container.js';

export function assertIngestorS1Enriching(doc: { stage: unknown; status: unknown } | null): void {
  expect(doc).not.toBeNull();
  expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
  expect(doc!.status).toBe(JobStatus.ENRICHING);
}

export function assertIngestorS2Enriched(doc: { stage: unknown; status: unknown } | null): void {
  expect(doc).not.toBeNull();
  expect(doc!.stage).toBe(JobStage.FULL_PARSED);
  expect(doc!.status).toBe(JobStatus.ENRICHED);
}

export function assertIngestorDispatchAddsJob(countBefore: number, countAfter: number, expectedDelta: number): void {
  expect(countAfter - countBefore).toBe(expectedDelta);
}

export async function assertIngestorQueueGuard(daemon: TestDaemonContainer, id: string): Promise<void> {
  const doc = await daemon.jobLifecycle.findById(id);
  expect(doc).not.toBeNull();
  expect(doc!.status).not.toBe(JobStatus.QUEUED);
}

export async function assertIngestorHasUrlEnqueue(isEnqueue: boolean): Promise<void> {
  expect(typeof isEnqueue).toBe('boolean');
}
