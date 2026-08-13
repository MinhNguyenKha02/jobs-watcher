import fs from 'node:fs';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { ProfileInfoRetriever } from '../../../src/domain/profile/index.js';
import { flattenJob } from '../../../src/domain/services/flatten-job.js';
import { JobStage, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { buildTestDaemonContainer, type TestDaemonContainer } from '../../helpers/test-container.js';

describe('Asset builder pipeline — full chain from queue action to PdfAsset', () => {
  let tc: TestDaemonContainer;

  beforeAll(async () => {
    // The chain is resolved through the production composition root: the real
    // AssetProducingAdapter is bound to a temp asset dir; storage is atomic.
    tc = await buildTestDaemonContainer({ ns: 'asset-builder-flow' });
    await tc.start();
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  it('GIVEN the Asset precondition WHEN flattenJob runs on the real Asset THEN flattenJob produces correct text from job lifecycle document (S2)', () => {
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

  it('GIVEN the Asset precondition WHEN flattenJob runs on the real Asset THEN flattenJob handles missing optional fields', () => {
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

  describe('ProfileInfoRetriever + AssetProducingAdapter pipeline', () => {
    let retriever: ProfileInfoRetriever;

    beforeAll(async () => {
      retriever = new ProfileInfoRetriever();
      await retriever.init();
    }, 30000);

    it('GIVEN the Asset precondition WHEN retrieve → resolve on the real Asset THEN retrieve + resolve produces ResolveOutput from flattened job text', () => {
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

    it('GIVEN the Asset precondition WHEN retrieve → resolve → toAsset on the real Asset THEN the container-resolved adapter writes a PDF to the configured asset dir', async () => {
      const jobText =
        'Role:\nSenior Frontend Developer\n\nCompany:\nZalo\n\nDescription:\nReact, TypeScript\n\n' +
        'Salary:\n$2500\n\nLocation:\nHCMC\n\n' +
        'Requirements:\nTypeScript, React\n\n' +
        'Benefits:\nHealth insurance';

      const retrieval = retriever.retrieve(jobText);
      const resolved = retriever.resolve(retrieval);
      const result = await tc.assetProducingAdapter.toAsset(resolved, tc.assetDir);

      expect(result.pdfPath).toBeDefined();
      expect(fs.existsSync(result.pdfPath!)).toBe(true);
      expect(result.pdfPath!).toMatch(/\.pdf$/);
    });
  });
});
