import { describe, it, expect } from 'vitest';

import { extractAllJobs } from '../../../../src/domain/services/extractor/jobs-extractor.js';
import { topcvEmailHtmlMany, indeedEmailHtmlMany } from '../../../../tests/helpers/html-fixtures.js';
import { topCVEmailAlert, indeedEmailAlert } from '../../../__fixtures__/emails.js';

describe('JobsExtractor', () => {
  describe('extractAllJobs — TopCV fixtures', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts all jobs from fixture', () => {
      const jobs = extractAllJobs(topCVEmailAlert);
      expect(jobs).toHaveLength(3);
      expect(jobs[0]).toMatchObject({
        role: 'Software Developer For Broadband Devices',
        company: 'MARUSYS VINA CO.,LTD',
      });
      expect(jobs[1]).toMatchObject({
        role: 'Front-End Developer',
        company: 'TEQNOLOGICAL ASIA Co., Ltd',
      });
      expect(jobs[2]).toMatchObject({
        role: '(Senior) Software Engineer, ReactJS',
        company: 'Zalo',
      });
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts salary from fixture', () => {
      const jobs = extractAllJobs(topCVEmailAlert);
      expect(jobs[0].salary).toContain('8 triệu');
      expect(jobs[1].salary).toContain('Thỏa thuận');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts deadline from fixture', () => {
      const jobs = extractAllJobs(topCVEmailAlert);
      expect(jobs[0].deadline).toContain('30 ngày');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts location from fixture', () => {
      const jobs = extractAllJobs(topCVEmailAlert);
      expect(jobs[0].location).toContain('Hà Nội');
      expect(jobs[1].location).toContain('Hồ Chí Minh');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts url from fixture', () => {
      const jobs = extractAllJobs(topCVEmailAlert);
      expect(jobs[0].url).toContain('topcv.vn');
    });
  });

  describe('extractAllJobs — TopCV helper builder (meta block)', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts multiple jobs', () => {
      const html = topcvEmailHtmlMany(
        [
          { role: 'Software Developer', company: 'ABC Corp' },
          { role: 'Frontend Engineer', company: 'XYZ Ltd' },
        ],
        { location: 'Hà Nội', salary: 'Từ 10 triệu', deadlineDays: 30 }
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ role: 'Software Developer', company: 'ABC Corp' });
      expect(jobs[1]).toMatchObject({ role: 'Frontend Engineer', company: 'XYZ Ltd' });
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts single job', () => {
      const html = topcvEmailHtmlMany(
        [{ role: 'Backend Developer', company: 'Tech Inc' }],
        { location: 'Đà Nẵng', salary: 'Từ 15 triệu', deadlineDays: 30 }
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].role).toBe('Backend Developer');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts deadline', () => {
      const html = topcvEmailHtmlMany(
        [{ role: 'Software Engineer', company: 'Cloud Co' }],
        { location: 'Hồ Chí Minh', salary: 'Từ 20 triệu', deadlineDays: 15 }
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].deadline).toContain('15 ngày');
    });
  });

  describe('extractAllJobs — Indeed fixtures', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts jobs from fixture', () => {
      const jobs = extractAllJobs(indeedEmailAlert);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ role: 'Senior Frontend Developer', company: 'Zalo' });
      expect(jobs[1]).toMatchObject({
        role: 'Senior Front-End Developer',
        company: 'AdStart Media Pte. Ltd',
      });
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts salary from fixture (2)', () => {
      const jobs = extractAllJobs(indeedEmailAlert);
      expect(jobs[0].salary).toContain('15,000,000');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts deadline from fixture (2)', () => {
      const jobs = extractAllJobs(indeedEmailAlert);
      expect(jobs[0].deadline).toContain('Just posted');
      expect(jobs[1].deadline).toContain('2 days ago');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts url from fixture (2)', () => {
      const jobs = extractAllJobs(indeedEmailAlert);
      expect(jobs[0].url).toContain('indeed.com');
    });
  });

  describe('extractAllJobs — Indeed helper builder (legacy layout)', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts a single Indeed job', () => {
      const html = indeedEmailHtmlMany([
        {
          role: 'Senior Frontend Developer',
          company: 'Zalo',
          url: 'https://vn.indeed.com/viewjob?jk=g3-a',
          salary: '15,000,000 VNĐ',
          description: 'Frontend role',
        },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ role: 'Senior Frontend Developer', company: 'Zalo' });
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts company, salary and deadline', () => {
      const html = indeedEmailHtmlMany([
        {
          role: 'Backend Developer',
          company: 'SHB',
          url: 'https://vn.indeed.com/viewjob?jk=g3-b',
          salary: '18,000,000 VNĐ',
          description: 'Backend role',
          daysAgo: '5 days ago',
        },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs[0].role).toBe('Backend Developer');
      expect(jobs[0].company).toBe('SHB');
      expect(jobs[0].salary).toBe('18,000,000 VNĐ');
      expect(jobs[0].deadline).toBe('5 days ago');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN detects easyApply', () => {
      const html = indeedEmailHtmlMany([
        {
          role: 'Frontend Developer',
          company: 'ABC',
          url: 'https://vn.indeed.com/viewjob?jk=g3-c',
          salary: '10,000,000 VNĐ',
          easyApply: true,
        },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].easyApply).toBe(true);
    });
  });

  describe('extractAllJobs — non-job HTML', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN returns empty array for plain HTML', () => {
      const html = '<html><body><p>No job content here</p></body></html>';
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(0);
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN returns empty array for empty string', () => {
      expect(extractAllJobs('')).toHaveLength(0);
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN returns empty array for malformed HTML', () => {
      expect(extractAllJobs('<unclosed>')).toHaveLength(0);
    });
  });
});
