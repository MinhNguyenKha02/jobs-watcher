import { describe, it, expect } from 'vitest';

import { extractAllJobs } from '../../../../src/domain/services/parsing/job-extraction.js';
import { topCVEmailAlert, indeedEmailAlert } from '../../../__fixtures__/emails.js';

function makeTopCvEmailHtml(
  ...jobs: Array<{
    role: string;
    company: string;
    location: string;
    salary: string;
    url: string;
    daysLeft?: number;
  }>
) {
  const items = jobs
    .map(
      (j) =>
        `<a class="job-item-link" href="${j.url}">
      <div class="job-item">
        <div class="avatar"><span class="company-logo"><img src="https://via.placeholder.com/67" alt=""/></span></div>
        <div class="body">
          <div class="title"><span>${j.role}</span></div>
          <div class="company"><span>${j.company}</span></div>
          <div class="meta-job">
            <div class="text-primary item"><b>${j.salary}</b></div>
            <div class="item">${j.location}</div>
            <div class="item">Còn <strong>${j.daysLeft ?? 30}</strong> ngày để ứng tuyển</div>
          </div>
        </div>
      </div>
    </a>`
    )
    .join('\n');
  return `<html><head></head><body>
    <h1>TopCV Job Alert</h1>
    <p>Xin chào, việc làm mới phù hợp với bạn:</p>
    <div class="job-list">${items}</div>
  </body></html>`;
}

function makeIndeedEmailHtml(
  jobs: Array<{
    role: string;
    company: string;
    location: string;
    salary: string;
    description?: string;
    daysAgo?: string;
    easyApply?: boolean;
    jk?: string;
  }>
) {
  const items = jobs
    .map((j) => {
      const jk = j.jk ?? 'test';
      const easyApplyBadge = j.easyApply ? '<span>Easily apply</span>' : '';
      return `<td align="left" valign="top" class="pb-24" style="padding:0 0 32px">
  <a href="https://vn.indeed.com/viewjob?jk=${jk}" style="display:block;text-decoration:none">
    <table cellPadding="0" cellSpacing="0" border="0" align="left" width="100%" role="presentation">
      <tr><td align="left" valign="top">
        <h2 style="color:#2d2d2d;font-family:'Indeed Sans','Noto Sans',Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;line-height:24px;Margin:0;padding:0"><a href="https://vn.indeed.com/viewjob?jk=${jk}" style="text-decoration:none">${j.role}</a></h2>
        <div style="color:#2d2d2d">${j.company}</div>
        <div style="color:#2d2d2d">${j.location}</div>
        <strong>${j.salary}</strong>
        <div style="color:#767676">${j.description ?? ''}</div>
        <div style="font-size:12px">${j.daysAgo ?? '30 days ago'}</div>
        ${easyApplyBadge}
      </td></tr>
    </table>
  </a>
</td>`;
    })
    .join('\n');
  return `<html><body>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td><p>Indeed Job Alert - new jobs found</p><p>indeed.com</p></td></tr>
    ${items}
    </table>
  </body></html>`;
}

describe('JobExtractionService', () => {
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

  describe('extractAllJobs — TopCV inline factory', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts multiple jobs', () => {
      const html = makeTopCvEmailHtml(
        {
          role: 'Software Developer',
          company: 'ABC Corp',
          location: 'Hà Nội',
          salary: 'Từ 10 triệu',
          url: 'https://www.topcv.vn/viec-lam/sw-dev/1',
        },
        {
          role: 'Frontend Engineer',
          company: 'XYZ Ltd',
          location: 'Hồ Chí Minh',
          salary: 'Thỏa thuận',
          url: 'https://www.topcv.vn/viec-lam/fe/2',
        }
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ role: 'Software Developer', company: 'ABC Corp' });
      expect(jobs[1]).toMatchObject({ role: 'Frontend Engineer', company: 'XYZ Ltd' });
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts single job', () => {
      const html = makeTopCvEmailHtml({
        role: 'Backend Developer',
        company: 'Tech Inc',
        location: 'Đà Nẵng',
        salary: 'Từ 15 triệu',
        url: 'https://www.topcv.vn/viec-lam/be/3',
      });
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].role).toBe('Backend Developer');
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts deadline', () => {
      const html = makeTopCvEmailHtml({
        role: 'DevOps Engineer',
        company: 'Cloud Co',
        location: 'Hồ Chí Minh',
        salary: 'Từ 20 triệu',
        url: 'https://www.topcv.vn/viec-lam/devops/4',
        daysLeft: 15,
      });
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

  describe('extractAllJobs — Indeed inline factory', () => {
    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts a single Indeed job', () => {
      const html = makeIndeedEmailHtml([
        {
          role: 'Senior Frontend Developer',
          company: 'Zalo',
          location: 'Ho Chi Minh City',
          salary: '15,000,000 VNĐ',
          description: 'Frontend role',
        },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ role: 'Senior Frontend Developer', company: 'Zalo' });
    });

    it('GIVEN JobExtractionService WHEN JobExtractionService evaluates THEN extracts company, salary and deadline', () => {
      const html = makeIndeedEmailHtml([
        {
          role: 'Backend Developer',
          company: 'SHB',
          location: 'Ha Noi',
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
      const html = makeIndeedEmailHtml([
        {
          role: 'Frontend Developer',
          company: 'ABC',
          location: 'Hanoi',
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
