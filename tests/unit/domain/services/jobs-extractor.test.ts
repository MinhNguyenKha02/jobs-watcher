import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { JobsExtractor } from '../../../../src/domain/services/extractor/jobs-extractor.js';
import type { Job } from '../../../../src/domain/types/job.js';

interface GmailMetaRecord {
  messageId: string;
  subject?: string;
  body: string;
}

function loadCorpus(name: string): GmailMetaRecord[] {
  const raw = readFileSync(
    join(import.meta.dirname, '..', '..', '..', '..', 'tests', 'fixtures', `${name}-gmailmeta.json`),
    'utf8'
  );
  return JSON.parse(raw) as GmailMetaRecord[];
}

const topcvCorpus = loadCorpus('topcv');
const indeedCorpus = loadCorpus('indeed');

describe('JobsExtractor', () => {
  let extractor: JobsExtractor;

  beforeEach(() => {
    extractor = new JobsExtractor();
  });

  describe('extractAllJobs — real TopCV alert corpus (tests/fixtures/topcv-gmailmeta.json)', () => {
    it.each(topcvCorpus.map((r, i) => [`#${i} ${r.messageId}`, r] as const))(
      'GIVEN real TopCV alert %s WHEN extractAllJobs evaluates THEN fills job fields (except details) for at least one job',
      (_label, record) => {
        const jobs = extractor.extractAllJobs(record.body);

        expect(jobs.length).toBeGreaterThan(0);
        for (const job of jobs as Array<Partial<Job>>) {
          expect(job.role?.trim()).toBeTruthy();
          expect(job.company?.trim()).toBeTruthy();
          expect(job.url?.trim()).toBeTruthy();
          if (job.location !== undefined) expect(job.location.trim()).toBeTruthy();
          if (job.salary !== undefined) expect(job.salary.trim()).toBeTruthy();
          if (job.deadline !== undefined) expect(job.deadline.trim()).toBeTruthy();
        }
      }
    );

    it('GIVEN the full TopCV corpus WHEN extractAllJobs evaluates THEN extracts across all alerts (hit-rate summary)', () => {
      const hits = topcvCorpus.filter((r) => extractor.extractAllJobs(r.body).length > 0);
      expect(hits.length).toBe(topcvCorpus.length);
    });
  });

  describe('extractAllJobs — real Indeed alert corpus (tests/fixtures/indeed-gmailmeta.json)', () => {
    it.each(indeedCorpus.map((r, i) => [`#${i} ${r.messageId}`, r] as const))(
      'GIVEN real Indeed alert %s WHEN extractAllJobs evaluates THEN fills job fields (except details) for at least one job',
      (_label, record) => {
        const jobs = extractor.extractAllJobs(record.body);

        expect(jobs.length).toBeGreaterThan(0);
        for (const job of jobs as Array<Partial<Job>>) {
          expect(job.role?.trim()).toBeTruthy();
          expect(job.company?.trim()).toBeTruthy();
          expect(job.url?.trim()).toMatch(/indeed\.com/);
          if (job.description !== undefined) expect(job.description.trim()).toBeTruthy();
          if (job.deadline !== undefined) expect(job.deadline.trim()).toBeTruthy();
        }
      }
    );

    it('GIVEN the full Indeed corpus WHEN extractAllJobs evaluates THEN extracts across all alerts (hit-rate summary)', () => {
      const hits = indeedCorpus.filter((r) => extractor.extractAllJobs(r.body).length > 0);
      expect(hits.length).toBeGreaterThan(0);
    });
  });
});
