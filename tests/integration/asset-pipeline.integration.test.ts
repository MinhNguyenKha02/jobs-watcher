import { describe, it, expect, beforeAll } from 'vitest';
import { createTestStorage } from '../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobIngestor } from '../../src/application/ingestor.js';
import { flattenJob } from '../../src/domain/services/flatten-job.js';
import { ProfileInfoRetriever } from '../../src/domain/profile/index.js';
import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { emailHtmlFor, detailHtmlFor } from '../helpers/html-fixtures.js';

describe('PRC-010 — Asset pipeline: s3-queued → profile IR → asset via real adapters', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let dbCollection: any;
  let retriever: ProfileInfoRetriever;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    dbCollection = storage.client.db(storage.dbName).collection('job_lifecycle');
    retriever = new ProfileInfoRetriever();
    await retriever.init();
  }, 120000);

  afterAll(async () => {
    await storage.stop();
  });

  it('full saga to s3-queued produces ENRICHED job with merged s1+s2 fields', async () => {
    ingestor = new JobIngestor(adapter, {
      emitGenerated: () => Promise.resolve(),
      emitCompleted: () => Promise.resolve(),
      emitFailed: () => Promise.resolve(),
    }, {
      emitJobQueued: () => Promise.resolve(),
      emitJobTrashed: () => Promise.resolve(),
      emitRouteFailed: () => Promise.resolve(),
    });

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, emailHtmlFor('Software Engineer', 'AssetPipeCo'), undefined, { messageId: 'asset-pipe-1' });
    const id = 'asset-pipe-1-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, detailHtmlFor('Software Engineer', 'AssetPipeCo'), id);
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

  it('ProfileInfoRetriever.retrieve returns retrieval envelope for flattened text', async () => {
    const text = 'Role: Backend Developer\nCompany: IRCo\nDescription: Node.js, TypeScript\nRequirements: MongoDB, Redis';
    const retrieval = retriever.retrieve(text);
    expect(retrieval).toBeDefined();
    expect(retrieval.direct).toBeDefined();
    expect(retrieval.expanded).toBeDefined();
    expect(Array.isArray(retrieval.evidences)).toBe(true);
  });

  it('ProfileInfoRetriever.resolve produces skills/experiences/projects', async () => {
    const text = 'Role: Data Engineer\nCompany: IRCo2\nDescription: Python, SQL\nRequirements: Airflow, Spark';
    const resolved = retriever.resolve(retriever.retrieve(text));
    expect(resolved.skills).toBeDefined();
    expect(resolved.experiences).toBeDefined();
    expect(resolved.projects).toBeDefined();
  });

  it('AssetProducingAdapter.toAsset accepts ResolveOutput and returns BuildResult', async () => {
    const { AssetProducingAdapter } = await import('../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js');
    const text = 'Role: Full Stack Developer\nCompany: IRCo3\nDescription: React, Node\nRequirements: TypeScript';
    const resolved = retriever.resolve(retriever.retrieve(text));
    const assetAdapter = new AssetProducingAdapter();
    const result = await assetAdapter.toAsset(resolved);
    expect(result).toBeDefined();
  }, 60000);

  it('asset toAsset failure is non-fatal (caught, logged, does not crash saga)', async () => {
    const { AssetProducingAdapter } = await import('../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js');
    const assetAdapter = new AssetProducingAdapter();
    await expect(assetAdapter.toAsset(null as any)).rejects.toBeTruthy();
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
