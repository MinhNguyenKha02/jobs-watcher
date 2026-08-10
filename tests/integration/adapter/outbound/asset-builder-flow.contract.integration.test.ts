import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import { createTestStorage } from '../../../helpers/create-test-storage.js';
import { MongoJobLifecycleAdapter } from '../../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { JobIngestor } from '../../../../src/application/ingestor.js';
import { flattenJob } from '../../../../src/domain/services/flatten-job.js';
import { ProfileInfoRetriever } from '../../../../src/domain/profile/index.js';
import { AssetProducingAdapter } from '../../../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { profileSource } from '../../../../src/domain/profile/source/profile.source.js';
import { JobSource, JobStage, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { ARTIFACT_OUTPUT_DIR } from '../../../../src/domain/profile/artifacts/constants/artifact.constants.js';

const hasArtifacts = fs.existsSync(ARTIFACT_OUTPUT_DIR);

describe('Asset builder pipeline — full chain from queue action to PdfAsset', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;

  beforeAll(async () => {
    storage = await createTestStorage();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
  }, 120000);

  afterAll(async () => {
    await storage.stop();
  });

  it('flattenJob produces correct text from job lifecycle document', () => {
    const doc = {
      _id: 'test-flatten-1',
      role: 'Software Engineer',
      company: 'TestCo',
      description: 'Node.js, TypeScript',
      salary: '$3000',
      location: 'HCMC',
      details: {
        requirements: 'TypeScript, Node.js, MongoDB',
        benefits: 'Health insurance, Remote work',
      },
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHED,
    };
    const result = flattenJob(doc as any);
    expect(result).toContain('Software Engineer');
    expect(result).toContain('TestCo');
    expect(result).toContain('Node.js, TypeScript');
    expect(result).toContain('$3000');
    expect(result).toContain('HCMC');
    expect(result).toContain('TypeScript, Node.js, MongoDB');
    expect(result).toContain('Health insurance, Remote work');
  });

  it('flattenJob handles missing optional fields', () => {
    const doc = {
      _id: 'test-flatten-2',
      role: 'Backend Developer',
      company: 'BackendCo',
    };
    const result = flattenJob(doc as any);
    expect(result).toContain('Backend Developer');
    expect(result).toContain('BackendCo');
    expect(result).not.toContain('Salary:');
    expect(result).not.toContain('Location:');
  });

  (hasArtifacts ? describe : describe.skip)(
    'ProfileInfoRetriever + AssetProducingAdapter pipeline',
    () => {
      let retriever: ProfileInfoRetriever;

      beforeAll(async () => {
        retriever = new ProfileInfoRetriever();
        await retriever.init();
      }, 30000);

      it('retrieve + resolve produces ResolveOutput from flattened job text', () => {
        const jobText =
          'Role:\nSoftware Engineer\n\nCompany:\nTestCo\n\nDescription:\nNode.js, TypeScript, Go\n\n' +
          'Salary:\n$3000\n\nLocation:\nHCMC\n\n' +
          'Requirements:\nTypeScript, Node.js, MongoDB\n\n' +
          'Benefits:\nHealth insurance, Remote work';

        const retrieval = retriever.retrieve(jobText);
        expect(retrieval).toBeDefined();
        expect(retrieval.direct).toBeDefined();
        expect(retrieval.expanded).toBeDefined();
        expect(Array.isArray(retrieval.evidences)).toBe(true);

        const resolved = retriever.resolve(retrieval);
        expect(resolved).toBeDefined();
        expect(resolved.skills).toBeDefined();
        expect(resolved.experiences).toBeDefined();
        expect(resolved.projects).toBeDefined();
      });

      it('AssetProducingAdapter.toPdf maps ResolveOutput to correct PdfAsset structure', () => {
        const jobText =
          'Role:\nSenior Frontend Developer\n\nCompany:\nZalo\n\nDescription:\nReact, TypeScript\n\n' +
          'Salary:\n$2500\n\nLocation:\nHCMC\n\n' +
          'Requirements:\nTypeScript, React\n\n' +
          'Benefits:\nHealth insurance';

        const retrieval = retriever.retrieve(jobText);
        const resolved = retriever.resolve(retrieval);
        const adapter = new AssetProducingAdapter();
        const pdf = adapter.toPdf(resolved, profileSource);

        expect(pdf.name).toBe(profileSource.name);
        expect(pdf.contact.email).toBe(profileSource.email);
        expect(pdf.skillGroups.length).toBeGreaterThan(0);
        expect(Array.isArray(pdf.experiences)).toBe(true);
        expect(Array.isArray(pdf.projects)).toBe(true);
      });
    }
  );
});
