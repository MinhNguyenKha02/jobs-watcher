import type { Job } from '../../src/domain/types/job.js';

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
