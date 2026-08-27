/**
 * Contract both ports helpers — src/application/ports 7 + src/presentation/tui/ports 2 ownership.
 * Additive for both application and presentation tui ports unless ingestor-contract only (see ingestor-contract.ts).
 */
import { expect } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

export function assertParseEmitGeneratesS1(doc: { stage: unknown; status: unknown }): void {
  expect(doc.stage).toBe(JobStage.PARTIAL_PARSED);
  expect(doc.status).toBe(JobStatus.ENRICHING);
}

export function assertRouteEmitsQueued(doc: { stage: unknown; status: unknown }): void {
  expect(doc.stage).toBe(JobStage.FULL_PARSED);
  expect(doc.status).toBe(JobStatus.QUEUED);
}

export function assertRouteEmitsTrashed(doc: { stage: unknown; status: unknown }): void {
  expect(doc.stage).toBe(JobStage.FULL_PARSED);
  expect(doc.status).toBe(JobStatus.TRASHED);
}

export function assertMongoFifoOrder(ids: string[], docs: { _id: string }[]): void {
  expect(docs.map((d) => d._id)).toEqual(ids);
}

export function assertMongoDedupe11000Skipped(countBefore: number, countAfter: number): void {
  expect(countAfter).toBe(countBefore);
}

export function assertAssetPdfValid(pdfPath: string): void {
  expect(pdfPath).toMatch(/\.pdf$/);
}

export function assertActionWriterOverUdsOk(res: { statusCode: number }): void {
  expect(res.statusCode).toBe(200);
}

export function assertActionWriterBoundary(res: { statusCode: number }, expected: number): void {
  expect(res.statusCode).toBe(expected);
}

export function assertReaderBindingForGenerated(ipcStage: unknown): void {
  expect(ipcStage).toBe(JobStage.PARTIAL_PARSED);
}

export function assertReaderBindingForParseCompleted(ipcStage: unknown): void {
  expect(ipcStage).toBe(JobStage.FULL_PARSED);
}

export function assertReaderIpcCleared(jobLifecycleId: unknown, job: unknown): void {
  expect(jobLifecycleId).toBeNull();
  expect(job).toBeNull();
}
