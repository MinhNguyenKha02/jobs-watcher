import { existsSync } from 'node:fs';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ProfileInfoRetriever } from '../../../src/domain/profile/index.js';
import { flattenJob } from '../../../src/domain/services/flatten-job.js';
import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';
import { buildTestDaemonContainer, type TestDaemonContainer } from '../../helpers/test-container.js';

describe('PRC-010 — Asset pipeline: s3-queued → profile IR → asset via container adapters', () => {
  let tc: TestDaemonContainer;
  let dbCollection: ReturnType<TestDaemonContainer['db']['collection']>;
  let retriever: ProfileInfoRetriever;

  beforeAll(async () => {
    tc = await buildTestDaemonContainer({ ns: 'asset-pipeline' });
    await tc.start();
    dbCollection = tc.db.collection('job_lifecycle');
    retriever = new ProfileInfoRetriever();
    await retriever.init();
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN the PRC precondition WHEN processIngest → processResolution on the real PRC THEN full saga to s3-queued produces ENRICHED job with merged s1+s2 fields (S2+S1+S3)', async () => {
    const queuedHandle = await tc.bus.setup([ActionEvent.QUEUED]);
    const id = 'asset-pipe-1-job-0';
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AssetPipeCo' }]),
      undefined,
      { messageId: 'asset-pipe-1' }
    );
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('Software Engineer', 'AssetPipeCo'),
      id
    );
    await tc.ingestor.processResolution(id, 'queue');

    const queued = await queuedHandle.msg();
    expect(queued.jobLifecycleId).toBe(id);

    const doc = await tc.mongoJobLifecycleAdapter.findById(id);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.QUEUED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(doc!.role).toBe('Software Engineer');
    expect(doc!.company).toBe('AssetPipeCo');
  });

  it('GIVEN the PRC precondition WHEN findById on the real PRC THEN flattenJob of queued doc yields profile-IR-ready text', async () => {
    const doc = await tc.mongoJobLifecycleAdapter.findById('asset-pipe-1-job-0');
    const text = flattenJob(doc as never);
    expect(text).toContain('Software Engineer');
    expect(text).toContain('AssetPipeCo');
  });

  it('GIVEN the PRC precondition WHEN retrieve on the real PRC THEN ProfileInfoRetriever.retrieve → returns retrieval envelope for flattened text', async () => {
    const text =
      'Role: Backend Developer\nCompany: IRCo\nDescription: Node.js, TypeScript\nRequirements: MongoDB, Redis';
    const retrieval = retriever.retrieve(text);
    expect(retrieval).toBeDefined();
    expect(retrieval.direct).toBeDefined();
    expect(retrieval.expanded).toBeDefined();
    expect(Array.isArray(retrieval.evidences)).toBe(true);
  });

  it('GIVEN the PRC precondition WHEN resolve → retrieve on the real PRC THEN ProfileInfoRetriever.resolve produces skills/experiences/projects', async () => {
    const text =
      'Role: Data Engineer\nCompany: IRCo2\nDescription: Python, SQL\nRequirements: Airflow, Spark';
    const resolved = retriever.resolve(retriever.retrieve(text));
    expect(resolved.skills).toBeDefined();
    expect(resolved.experiences).toBeDefined();
    expect(resolved.projects).toBeDefined();
  });

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN AssetProducingAdapter.toAsset (container-resolved) writes a PDF into the configured output dir', async () => {
    const text =
      'Role: Full Stack Developer\nCompany: IRCo3\nDescription: React, Node\nRequirements: TypeScript';
    const resolved = retriever.resolve(retriever.retrieve(text));
    const result = await tc.assetProducingAdapter.toAsset(resolved, tc.assetDir);
    expect(result).toBeDefined();
    expect(result.pdfPath).toBeDefined();
    expect(existsSync(result.pdfPath!)).toBe(true);
    expect(result.pdfPath!).toMatch(/\.pdf$/);
  }, 60000);

  it('GIVEN the PRC precondition WHEN the port is exercised on the real PRC THEN queued doc is the input contract for profile IR (stage full_parsed + status queued) (S2+S3)', async () => {
    const docs = await dbCollection.find({ status: JobStatus.QUEUED }).toArray();
    expect(docs.length).toBeGreaterThanOrEqual(1);
    for (const d of docs) {
      expect(d.stage).toBe(JobStage.FULL_PARSED);
    }
  });
});

describe('PRC-010 — Asset pipeline resilience (non-fatal toAsset failure)', () => {
  let tc: TestDaemonContainer;

  beforeAll(async () => {
    tc = await buildTestDaemonContainer({
      ns: 'asset-pipeline-failure',
      ports: {
        // Scripted asset seam: toAsset rejects — the saga must still emit QUEUED
        // and keep the job QUEUED (non-fatal).
        assetProducing: {
          toAsset: async () => {
            throw new Error('asset boom');
          },
        },
      },
    });
    await tc.start();
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN the PRC precondition WHEN resolve → processIngest → processResolution on the real PRC THEN asset toAsset failure is non-fatal in the saga (QUEUED still emitted, job still QUEUED) (S2+S1+S3)', async () => {
    const queuedHandle = await tc.bus.setup([ActionEvent.QUEUED]);
    const id = 'asset-fail-1-job-0';
    await tc.ingestor.processIngest(
      JobSource.BROWSER_AUTO,
      JobStage.PARTIAL_PARSED,
      topcvEmailHtmlMany([{ role: 'DevOps Engineer', company: 'ResilienceCo' }]),
      undefined,
      { messageId: 'asset-fail-1' }
    );
    await tc.ingestor.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      topcvDetailHtml('DevOps Engineer', 'ResilienceCo'),
      id
    );

    await expect(tc.ingestor.processResolution(id, 'queue')).resolves.toBeUndefined();
    const queued = await queuedHandle.msg();
    expect(queued.jobLifecycleId).toBe(id);

    const doc = await tc.mongoJobLifecycleAdapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });
});
