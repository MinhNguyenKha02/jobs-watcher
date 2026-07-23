import { describe, it, expect } from 'vitest';
import { extractAllJobs } from '../../../src/domain/services/parsing/job-extraction.js';

function makeTopCvEmailHtml(...jobs: Array<{ role: string; company: string; location: string; salary: string; url: string; daysLeft?: number }>) {
  const items = jobs.map((j) =>
    `<a class="job-item-link" href="${j.url}" style="display:block">
      <div class="topcv-job-item">
        <div class="title"><span>${j.role}</span></div>
        <div class="company"><span>${j.company}</span></div>
        <div class="text-primary"><b>${j.salary}</b></div>
        <div>${j.location}</div>
        <div>Còn <strong>${j.daysLeft ?? 30}</strong> ngày để ứng tuyển</div>
      </div>
    </a>`
  ).join('\n');
  return `<html><head></head><body>
    <h1>TopCV Job Alert</h1>
    <p>Xin chào, việc làm mới phù hợp với bạn:</p>
    <div class="job-list">${items}</div>
    <p>topcv job-item</p>
  </body></html>`;
}

function makeIndeedEmailHtml(jobs: Array<{ role: string; company: string; location: string; salary: string; description?: string; daysAgo?: string; easyApply?: boolean }>) {
  const items = jobs.map((j) => {
    const easyApplyBadge = j.easyApply ? '<span>Easily apply</span>' : '';
    return `<td class="pb-24" style="padding-bottom:24px">
      <h2 class="strong-text-link"><a href="https://www.indeed.com/viewjob?jk=test">${j.role}</a></h2>
      <div style="color:#2d2d2d">${j.company}</div>
      <div style="color:#2d2d2d">${j.location}</div>
      <strong>${j.salary}</strong>
      <div style="color:#767676">${j.description ?? ''}</div>
      <div style="font-size:12px">${j.daysAgo ?? '30 days ago'}</div>
      ${easyApplyBadge}
    </td>`;
  }).join('\n');
  return `<html><body>
    <p>Indeed Job Alert indeed.com</p>
    <table><tr>${items}</tr></table>
  </body></html>`;
}

describe('JobExtractionService', () => {
  describe('extractAllJobs — TopCV multi-job', () => {
    it('extracts multiple jobs from TopCV email HTML', () => {
      const html = makeTopCvEmailHtml(
        { role: 'Software Developer', company: 'ABC Corp', location: 'Hà Nội', salary: 'Từ 10 triệu', url: 'https://www.topcv.vn/viec-lam/software-developer/1' },
        { role: 'Frontend Engineer', company: 'XYZ Ltd', location: 'Hồ Chí Minh', salary: 'Thỏa thuận', url: 'https://www.topcv.vn/viec-lam/frontend-engineer/2' },
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ role: 'Software Developer', company: 'ABC Corp' });
      expect(jobs[1]).toMatchObject({ role: 'Frontend Engineer', company: 'XYZ Ltd' });
    });

    it('extracts single job from TopCV email', () => {
      const html = makeTopCvEmailHtml(
        { role: 'Backend Developer', company: 'Tech Inc', location: 'Đà Nẵng', salary: 'Từ 15 triệu', url: 'https://www.topcv.vn/viec-lam/backend/3' },
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].role).toBe('Backend Developer');
    });

    it('extracts deadline from TopCV email', () => {
      const html = makeTopCvEmailHtml(
        { role: 'DevOps Engineer', company: 'Cloud Co', location: 'Hồ Chí Minh', salary: 'Từ 20 triệu', url: 'https://www.topcv.vn/viec-lam/devops/4', daysLeft: 15 },
      );
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].deadline).toContain('15 ngày');
    });
  });

  describe('extractAllJobs — Indeed email', () => {
    it('extracts a single Indeed job from email with indeed.com marker', () => {
      const html = makeIndeedEmailHtml([
        { role: 'Senior Frontend Developer', company: 'Zalo', location: 'Ho Chi Minh City', salary: '15,000,000 VNĐ', description: 'Frontend role' },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ role: 'Senior Frontend Developer', company: 'Zalo' });
    });

    it('extracts single Indeed job with company, salary and deadline', () => {
      const html = makeIndeedEmailHtml([
        { role: 'Backend Developer', company: 'SHB', location: 'Ha Noi', salary: '18,000,000 VNĐ', description: 'Backend role', daysAgo: '5 days ago' },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].role).toBe('Backend Developer');
      expect(jobs[0].company).toBe('SHB');
      expect(jobs[0].salary).toBe('18,000,000 VNĐ');
      expect(jobs[0].deadline).toBe('5 days ago');
    });

    it('detects easyApply on Indeed job', () => {
      const html = makeIndeedEmailHtml([
        { role: 'Frontend Developer', company: 'ABC', location: 'Hanoi', salary: '10,000,000 VNĐ', easyApply: true },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].easyApply).toBe(true);
    });

    it('returns empty array for Indeed email without recognizable job format', () => {
      const html = `<html><body><p>Indeed Job Alert indeed.com</p><div>some content</div></body></html>`;
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(0);
    });
  });

  describe('extractAllJobs — non-job HTML', () => {
    it('returns empty array for plain HTML', () => {
      const html = '<html><body><p>No job content here</p></body></html>';
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(0);
    });

    it('returns empty array for empty string', () => {
      expect(extractAllJobs('')).toHaveLength(0);
    });

    it('returns empty array for malformed HTML', () => {
      expect(extractAllJobs('<unclosed>')).toHaveLength(0);
    });
  });
});
