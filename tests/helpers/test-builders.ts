import { JobStage, JobSource, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import type { Job } from '../../src/domain/types/job.js';

/**
 * Test Data Builder for an s1 job-metadata document (PARTIAL_PARSED / ENRICHING),
 * as directly persisted to `job_lifecycle`. Overrides win over defaults.
 */
export function makeStage1Partial(overrides: Record<string, unknown> = {}): any {
  return {
    _id: overrides._id ?? 'test-id',
    raw: '<html><body>partial</body></html>',
    stage: JobStage.PARTIAL_PARSED,
    status: JobStatus.ENRICHING,
    source: JobSource.BROWSER_AUTO,
    company: overrides.company ?? 'TestCo',
    role: overrides.role ?? 'Software Engineer',
    description: 'TypeScript developer',
    location: 'Test Location',
    url: 'https://test.com/job',
    salary: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    stageTimestamp: new Date(),
    ...overrides,
  };
}

/**
 * Test Data Builder for an s2 job payload document (FULL_PARSED / ENRICHED).
 */
export function makeFullParsedDoc(overrides: Record<string, unknown> = {}): any {
  return {
    ...makeStage1Partial(),
    stage: JobStage.FULL_PARSED,
    status: JobStatus.ENRICHED,
    ...overrides,
  };
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    _id: 'test-msg-001',
    role: 'Software Developer',
    company: 'Generic Company',
    location: 'Unknown',
    salary: '',
    description: 'Old description that will be replaced',
    url: 'https://example.com',
    ...overrides,
  };
}