/**
 * E2e outcome-only helpers — ipc downstream rmq consumer + artifact pdf outcome (not exclusive events.on).
 * Asset-e2e remains even with PE ignored (gmail-corpus + asset-e2e wrote and remain).
 */
import fs from 'node:fs';
import path from 'node:path';

import { expect } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

import type { TestDaemonContainer } from './test-container.js';

export async function assertOutcomeQueued(
  daemon: TestDaemonContainer,
  jobId: string
): Promise<void> {
  const doc = await daemon.jobLifecycle.findById(jobId);
  expect(doc).not.toBeNull();
  expect(doc!.status).toBe(JobStatus.QUEUED);
  expect(doc!.stage).toBe(JobStage.FULL_PARSED);
}

export async function assertOutcomeTrashed(
  daemon: TestDaemonContainer,
  jobId: string
): Promise<void> {
  const doc = await daemon.jobLifecycle.findById(jobId);
  expect(doc).not.toBeNull();
  expect(doc!.status).toBe(JobStatus.TRASHED);
}

export function assertOutcomePdf(pdfPath: string): void {
  expect(pdfPath).toMatch(/\.pdf$/);
  expect(fs.existsSync(pdfPath)).toBe(true);
  const header = fs.readFileSync(pdfPath).slice(0, 4).toString();
  expect(header).toBe('%PDF');
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);
}

export async function assertOutcomePdfInDir(daemon: TestDaemonContainer): Promise<string> {
  const pdfs = fs.readdirSync(daemon.assetDir).filter((f) => f.endsWith('.pdf'));
  expect(pdfs.length).toBeGreaterThan(0);
  const newest = pdfs
    .map((f) => path.join(daemon.assetDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  return newest;
}
