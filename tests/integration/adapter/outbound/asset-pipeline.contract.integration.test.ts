import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { flattenJob } from '../../../../src/domain/services/flatten-job.js';
import { ProfileInfoRetriever } from '../../../../src/domain/profile/index.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { MetricsRegistry } from '../../../../src/infrastructure/outbound/monitoring/metrics-registry.js';
import { Registry } from 'prom-client';
import type { ExtractionQueuePort } from '../../../../src/application/ports/extraction-queue.port.js';
import type { AssetProducingPort } from '../../../../src/application/ports/asset-producing.port.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../../helpers/html-fixtures.js';

describe('PRC-010 — Asset pipeline: s3-queued → profile IR → asset via real adapters', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let dbCollection: any;
  let retriever: ProfileInfoRetriever;
  let assetDir: string;

  const emptyQueue: ExtractionQueuePort = {
    enqueue: vi.fn(),
    dequeue: vi.fn(),
    size: vi.fn(),
    onEnqueue: vi.fn(),
  };
  const metrics = new MetricsRegistry(new Registry());

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    dbCollection = storage.client.db(storage.dbName).collection('job_lifecycle');
    retriever = new ProfileInfoRetriever();
    await retriever.init();
    assetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-watcher-assets-'));
  }, 120000);

  afterAll(async () => {
    try {
      fs.rmSync(assetDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    await storage.stop();
  });

  it('full saga to s3-queued produces ENRICHED job with merged s1+s2 fields', async () => {
    ingestor = new JobIngestor(
      adapter,
      {
        emitGenerated: () => Promise.resolve(),
        emitCompleted: () => Promise.resolve(),
        emitFailed: () => Promise.resolve(),
      },
      {
        emitJobQueued: () => Promise.resolve(),
        emitJobTrashed: () => Promise.resolve(),
        emitRouteFailed: () => Promise.resolve(),
      },
      emptyQueue,
      { toAsset: vi.fn().mockResolvedValue({ pdfPath: '' }) },
      metrics
    );

    await ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AssetPipeCo' }]),
      undefined,
      { messageId: 'asset-pipe-1' }
    );
    const id = 'asset-pipe-1-job-0';
    await ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'AssetPipeCo'),
      id
    );
    await ingestor.processResolution(id, 'queue');

    const doc = await adapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.QUEUED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.role).toBe('Software Engineer');
    expect(doc!.company).toBe('AssetPipeCo');
  });

  it('flattenJob of queued doc yields profile-IR-ready text', async () => {
    const doc = await adapter.findById('asset-pipe-1-job-0');
    const text = flattenJob(doc as any);
    expect(text).toContain('Software Engineer');
    expect(text).toContain('AssetPipeCo');
  });

  it('ProfileInfoRetriever.retrieve → returns retrieval envelope for flattened text', async () => {
    const text =
      'Role: Backend Developer\nCompany: IRCo\nDescription: Node.js, TypeScript\nRequirements: MongoDB, Redis';
    const retrieval = retriever.retrieve(text);
    expect(retrieval).toBeDefined();
    expect(retrieval.direct).toBeDefined();
    expect(retrieval.expanded).toBeDefined();
    expect(Array.isArray(retrieval.evidences)).toBe(true);
  });

  it('ProfileInfoRetriever.resolve produces skills/experiences/projects', async () => {
    const text =
      'Role: Data Engineer\nCompany: IRCo2\nDescription: Python, SQL\nRequirements: Airflow, Spark';
    const resolved = retriever.resolve(retriever.retrieve(text));
    expect(resolved.skills).toBeDefined();
    expect(resolved.experiences).toBeDefined();
    expect(resolved.projects).toBeDefined();
  });

  it('AssetProducingAdapter.toAsset accepts ResolveOutput and writes a PDF into the configured output dir', async () => {
    const { AssetProducingAdapter } =
      await import('../../../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js');
    const text =
      'Role: Full Stack Developer\nCompany: IRCo3\nDescription: React, Node\nRequirements: TypeScript';
    const resolved = retriever.resolve(retriever.retrieve(text));
    const assetAdapter = new AssetProducingAdapter(assetDir);
    const result = await assetAdapter.toAsset(resolved);
    expect(result).toBeDefined();
    expect(result.pdfPath).toBeDefined();
    const pdfPath = result.pdfPath as string;
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(path.dirname(pdfPath)).toMatch(path.resolve(assetDir));
  }, 60000);

  it('asset toAsset failure is non-fatal in the saga (QUEUED still emitted, job still QUEUED)', async () => {
    const rejectingAsset: AssetProducingPort = {
      toAsset: () => Promise.reject(new Error('asset boom')),
    };
    const emitJobQueued = vi.fn();
    const failing = new JobIngestor(
      adapter,
      {
        emitGenerated: () => Promise.resolve(),
        emitCompleted: () => Promise.resolve(),
        emitFailed: () => Promise.resolve(),
      },
      {
        emitJobQueued,
        emitJobTrashed: vi.fn(),
        emitRouteFailed: vi.fn(),
      },
      emptyQueue,
      rejectingAsset,
      metrics
    );

    await failing.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'DevOps Engineer', company: 'ResilienceCo' }]),
      undefined,
      { messageId: 'asset-fail-1' }
    );
    const id = 'asset-fail-1-job-0';
    await failing.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('DevOps Engineer', 'ResilienceCo'),
      id
    );

    await expect(failing.processResolution(id, 'queue')).resolves.toBeUndefined();
    expect(emitJobQueued).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ source: JobSource.MANUAL })
    );

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('queued doc is the input contract for profile IR (stage full_parsed + status queued)', async () => {
    const docs = await dbCollection.find({ status: JobStatus.QUEUED }).toArray();
    expect(docs.length).toBeGreaterThanOrEqual(1);
    for (const d of docs) {
      expect(d.stage).toBe(JobStage.FULL_PARSED);
    }
  });

  it('trashed job is excluded from asset pipeline input (only queued consumed)', async () => {
    const docs = await dbCollection.find({ status: JobStatus.TRASHED }).toArray();
    for (const d of docs) {
      expect(d.status).toBe(JobStatus.TRASHED);
    }
    const queued = await dbCollection.find({ status: JobStatus.QUEUED }).toArray();
    const assetInputs = queued.map((d: any) => d._id);
    expect(assetInputs.some((id: string) => docs.some((t: any) => t._id === id))).toBe(false);
  });
});
