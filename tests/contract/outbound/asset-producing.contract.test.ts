import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { ProfileInfoRetriever } from '../../../src/domain/profile/index.js';
import { flattenJob } from '../../../src/domain/services/flatten-job.js';
import type { PdfAsset } from '../../../src/domain/types/asset.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { renderPdf } from '../../../src/infrastructure/outbound/asset-builder/renderer/pdf-renderer.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

function pdfCount(dir: string): number {
  const walk = (d: string): number => {
    let c = 0;
    try {
      const ents = fs.readdirSync(d, { withFileTypes: true });
      for (const en of ents) {
        if (en.isFile() && en.name.endsWith('.pdf')) c++;
        else if (en.isDirectory()) c += walk(path.join(d, en.name));
      }
    } catch {}
    return c;
  };
  return walk(dir);
}

function makeAsset(overrides?: Partial<PdfAsset>): PdfAsset {
  return {
    name: 'John Doe',
    contact: {
      email: 'john@example.com',
      phone: '+1 234 567 890',
      location: 'New York, USA',
    },
    skillGroups: [
      { label: 'Frameworks', skills: ['Node.js', 'Express.js'] },
      { label: 'Languages', skills: ['TypeScript'] },
    ],
    experiences: [],
    education: [],
    projects: [],
    ...overrides,
  };
}

/**
 * AssetProducingPort contract over the production composition root: a job must
 * reach s3-queued before `toAsset` runs; profile-IR resolution feeds the real
 * handlebars+chromium `renderPdf`. Terms:
 *   (a) queued → profile IR → toAsset writes a real PDF into the asset dir
 *   (b) s3 `queued` is the only trigger (guard rejects non-ENRICHED)
 *   (c) trashed/failed states produce no asset and no side-effect
 *   (d) renderPdf produces valid PDF bytes from the real template+chromium
 */
describe('AssetProducingPort — production asset contract · contract asset-producing', () => {
  describe('(a) queued → profile IR → toAsset writes a real PDF into the asset dir (S1+S2+S3)', () => {
    let daemon: TestDaemonContainer;
    let tui: TuiTestContainer;
    let dbCollection: ReturnType<TestDaemonContainer['mongo']['raw']>;
    let retriever: ProfileInfoRetriever;

    beforeAll(async () => {
      daemon = await buildTestDaemonContainer({ ns: 'asset-producing' });
      await daemon.start();
      tui = await buildTestTuiContainer({ ns: 'asset-producing' });
      dbCollection = daemon.mongo.raw('job_lifecycle');
      retriever = new ProfileInfoRetriever();
      await retriever.init();
    }, 120000);

    afterAll(async () => {
      // Per-suite cycle teardown: stops first, then self-deletes the 4
      // namespaced queues + test exchange (finally => no cleanup script).
      try {
        await tui.stop();
        await daemon.stop();
      } finally {
        await tui.reader.deleteQueues();
      }
    });

    beforeEach(async () => {
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
    });

    it('GIVEN the asset-producing precondition WHEN processIngest → processResolution on the real AssetProducingPort THEN full saga to s3-queued produces a QUEUED job with merged s1+s2 fields (S1+S2+S3)', async () => {
      const id = 'asset-prod-1-job-0';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AssetProdCo' }]),
        undefined,
        { messageId: 'asset-prod-1' }
      );
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'AssetProdCo'),
        id
      );
      await tui.writer.queue(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);
      await waitFor(() => pdfCount(daemon.assetDir) > 0, 25000);
      expect(pdfCount(daemon.assetDir)).toBeGreaterThan(0);

      const doc = await daemon.jobLifecycle.findById(id);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.role).toBe('Software Engineer');
      expect(doc!.company).toBe('AssetProdCo');
    });

    it('GIVEN a queued doc in the store WHEN flattenJob on the real AssetProducingPort THEN the queued lifecycle doc flattens to profile-IR-ready text', async () => {
      const doc = await daemon.jobLifecycle.findById('asset-prod-1-job-0');
      const text = flattenJob(doc as never);
      expect(text).toContain('Software Engineer');
      expect(text).toContain('AssetProdCo');
    });

    it('GIVEN a flattened job when retrieve → resolve on the real AssetProducingPort THEN the profile-IR envelope yields skills/experiences/projects', async () => {
      const text =
        'Role: Backend Developer\nCompany: IRCo\nDescription: Node.js, TypeScript\nRequirements: MongoDB, Redis';
      const retrieval = retriever.retrieve(text);
      expect(retrieval).toBeDefined();
      expect(retrieval.direct).toBeDefined();
      expect(retrieval.expanded).toBeDefined();
      expect(Array.isArray(retrieval.evidences)).toBe(true);

      const resolved = retriever.resolve(retrieval);
      expect(resolved.skills).toBeDefined();
      expect(resolved.experiences).toBeDefined();
      expect(resolved.projects).toBeDefined();
    });

    it('GIVEN a resolve output WHEN toAsset on the real AssetProducingPort THEN a PDF asset is written into the kernel-configured asset dir with %PDF bytes', async () => {
      const text =
        'Role: Full Stack Developer\nCompany: IRCo3\nDescription: React, Node\nRequirements: TypeScript';
      const resolved = retriever.resolve(retriever.retrieve(text));

      const result = await daemon.assetProducing.toAsset(resolved, daemon.assetDir);
      expect(result).toBeDefined();
      expect(result.pdfPath).toBeDefined();
      expect(fs.existsSync(result.pdfPath!)).toBe(true);
      expect(result.pdfPath!).toMatch(/\.pdf$/);
      expect(fs.readFileSync(result.pdfPath!).slice(0, 4).toString()).toBe('%PDF');
    }, 60000);

    it('GIVEN the s3-queued saga WHEN the store is queried on the real AssetProducingPort THEN the queued doc is the input contract for profile IR (stage full_parsed + status queued) (S2+S3)', async () => {
      const docs = await dbCollection.find({ status: JobStatus.QUEUED }).toArray();
      expect(docs.length).toBeGreaterThanOrEqual(1);
      for (const d of docs) {
        expect(d.stage).toBe(JobStage.FULL_PARSED);
      }
    });
  });

  describe('(b) s3 `queued` is the only asset trigger — queue guard rejects non-ENRICHED jobs (S1+S2)', () => {
    let daemon: TestDaemonContainer;
    let tui: TuiTestContainer;

    beforeAll(async () => {
      daemon = await buildTestDaemonContainer({ ns: 'asset-producing-guard' });
      await daemon.start();
      tui = await buildTestTuiContainer({ ns: 'asset-producing-guard' });
    }, 120000);

    afterAll(async () => {
      // Per-suite cycle teardown: stops first, then self-deletes the 4
      // namespaced queues + test exchange (finally => no cleanup script).
      try {
        await tui.stop();
        await daemon.stop();
      } finally {
        await tui.reader.deleteQueues();
      }
    });

    beforeEach(async () => {
      await daemon.storage.clearDb();
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
    });

    it('GIVEN an s1-partial (non-ENRICHED) doc WHEN processResolution(queue) on the real AssetProducingPort THEN the [j] guard rejects the queue action (no QUEUED event, status stays ENRICHING)', async () => {
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'GuardCo' }]),
        undefined,
        { messageId: 'asset-guard-1' }
      );
      const doc = await daemon.jobLifecycle.findById('asset-guard-1-job-0');
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHING);

      const baseline = pdfCount(daemon.assetDir);
      await daemon.apps.ingest.processResolution('asset-guard-1-job-0', 'queue');

      await new Promise((r) => setTimeout(r, 500));
      expect(pdfCount(daemon.assetDir)).toBe(baseline);
      expect(tui.ipc.read().jobLifecycleId).not.toBeNull();
      expect(tui.ipc.read().jobLifecycleId).toBe('asset-guard-1-job-0');
      const after = await daemon.jobLifecycle.findById('asset-guard-1-job-0');
      expect(after!.status).toBe(JobStatus.ENRICHING);
      expect(after!.stage).toBe(JobStage.PARTIAL_PARSED);
    });
  });

  describe('(c) trashed/failed states produce no asset and no side-effect (S2+S1+S4)', () => {
    let daemon: TestDaemonContainer;
    let tui: TuiTestContainer;

    beforeAll(async () => {
      daemon = await buildTestDaemonContainer({ ns: 'asset-producing-terminal' });
      await daemon.start();
      tui = await buildTestTuiContainer({ ns: 'asset-producing-terminal' });
    }, 120000);

    afterAll(async () => {
      // Per-suite cycle teardown: stops first, then self-deletes the 4
      // namespaced queues + test exchange (finally => no cleanup script).
      try {
        await tui.stop();
        await daemon.stop();
      } finally {
        await tui.reader.deleteQueues();
      }
    });

    beforeEach(async () => {
      await daemon.storage.clearDb();
      await tui.reader.purgeQueues();
      tui.reader.resetReader();
      tui.ipc.clear();
    });

    it('GIVEN a full merge THEN trash resolution on the real AssetProducingPort THEN the job goes TRASHED and no PDF asset is produced', async () => {
      const id = 'asset-term-1-job-0';
      await daemon.apps.ingest.processIngest(
        JobSource.BROWSER_AUTO,
        JobStage.PARTIAL_PARSED,
        topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'TermCo' }]),
        undefined,
        { messageId: 'asset-term-1' }
      );
      await daemon.apps.ingest.processIngest(
        JobSource.MANUAL,
        JobStage.FULL_PARSED,
        topcvDetailHtml('Software Engineer', 'TermCo'),
        id
      );

      const baseline = pdfCount(daemon.assetDir);
      await tui.writer.trash(id);
      await waitFor(() => tui.ipc.read().jobLifecycleId === null);

      const doc = await daemon.jobLifecycle.findById(id);
      expect(doc!.status).toBe(JobStatus.TRASHED);
      expect(pdfCount(daemon.assetDir)).toBe(baseline);
    });

    it('GIVEN the asset-producing precondition WHEN resolve → processResolution(queue) on the real AssetProducingPort THEN a failing toAsset is non-fatal (QUEUED still emitted, job stays QUEUED)', async () => {
      const failDaemon = await buildTestDaemonContainer(
        { ns: 'asset-producing-failure' },
        {
          ports: {
            assetProducing: {
              toAsset: async () => {
                throw new Error('asset boom');
              },
            },
          },
        }
      );
      await failDaemon.start();
      const failTui = await buildTestTuiContainer({ ns: 'asset-producing-failure' });
      try {
        const id = 'asset-fail-1-job-0';
        await failDaemon.apps.ingest.processIngest(
          JobSource.BROWSER_AUTO,
          JobStage.PARTIAL_PARSED,
          topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'ResilienceCo' }]),
          undefined,
          { messageId: 'asset-fail-1' }
        );
        await failDaemon.apps.ingest.processIngest(
          JobSource.MANUAL,
          JobStage.FULL_PARSED,
          topcvDetailHtml('DevOps Engineer', 'ResilienceCo'),
          id
        );

        await failTui.writer.queue(id);
        await waitFor(() => failTui.ipc.read().jobLifecycleId === null);

        const doc = await failDaemon.jobLifecycle.findById(id);
        expect(doc!.status).toBe(JobStatus.QUEUED);
      } finally {
        // Mid-test harness on its own ns: same per-suite cycle teardown.
        try {
          await failTui.stop();
          await failDaemon.stop();
        } finally {
          await failTui.reader.deleteQueues();
        }
      }
    });
  });

  describe('(d) renderPdf — real handlebars template + chromium → valid PDF bytes', () => {
    it('GIVEN a PdfAsset WHEN renderPdf on the real AssetProducingPort THEN PDF is written into the output dir with %PDF header bytes', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-contract-'));
      try {
        const outputPath = await renderPdf(makeAsset(), tmpDir);
        expect(outputPath).toContain('ats.pdf');
        expect(fs.existsSync(outputPath)).toBe(true);
        const header = fs.readFileSync(outputPath).slice(0, 4).toString();
        expect(header).toBe('%PDF');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('GIVEN a PdfAsset WHEN renderPdf on the real AssetProducingPort THEN intermediate output dirs are created before writing the PDF', async () => {
      const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-contract-nested-'));
      const deepDir = path.join(nestedDir, 'sub', 'dir');
      try {
        const outputPath = await renderPdf(makeAsset(), deepDir);
        expect(fs.existsSync(outputPath)).toBe(true);
      } finally {
        fs.rmSync(nestedDir, { recursive: true, force: true });
      }
    });

    it('GIVEN a PdfAsset WHEN renderPdf on the real AssetProducingPort THEN the rendered PDF is non-empty', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-contract-size-'));
      try {
        const outputPath = await renderPdf(makeAsset(), tmpDir);
        expect(fs.statSync(outputPath).size).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('GIVEN a PdfAsset WHEN renderPdf on the real AssetProducingPort THEN the candidate name renders into the intermediate HTML source', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-contract-name-'));
      try {
        await renderPdf(makeAsset(), tmpDir);
        const htmlPath = path.join(tmpDir, 'ats.html');
        expect(fs.existsSync(htmlPath)).toBe(true);
        const html = fs.readFileSync(htmlPath, 'utf-8');
        expect(html).toContain('John Doe');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
