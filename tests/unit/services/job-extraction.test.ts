import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractAllJobs } from '../../../src/domain/services/parsing/job-extraction.js' ;

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

function makeIndeedEmailHtml(jobs: Array<{ role: string; company: string; location: string; salary: string; url: string; daysAgo?: number; description?: string; easyApply?: boolean }>) {
  const items = jobs.map((j) => {
    const dateText = j.daysAgo != null ? `${j.daysAgo} days ago` : 'Just posted';
    const easyApplyText = j.easyApply ? 'Easily apply' : '';
    return `<tr>
  <td class="pb-24" style="padding-bottom:24px">
    <a href="${j.url}" class="strong-text-link">${j.role}</a>
    <br>
    <table><tr><td style="padding:0 12px;color:#2d2d2d;font-size:14px;line-height:21px">${j.company}</td></tr></table>
    </td></tr>
    <tr><td style="color:#2d2d2d;font-size:14px;line-height:21px">${j.location}</td></tr>
    <strong>${j.salary}</strong>
    <td style="padding:0;color:#767676;font-size:14px;line-height:21px">${j.description ?? ''}</td>
    <td style="font-size:12px;line-height:18px">${dateText}</td>
    ${easyApplyText}
  </td>
</tr>`;
  }).join('\n');
  return `<html><body>
<p>Indeed Job Alert</p>
<p>strong-text-link</p>
<table>${items}</table>
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
      expect(jobs[0]).toMatchObject({ role: 'Software Developer', company: 'ABC Corp', source: 'topcv' });
      expect(jobs[1]).toMatchObject({ role: 'Frontend Engineer', company: 'XYZ Ltd', source: 'topcv' });
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
      expect(jobs[0].deadline).toBeDefined();
    });

    it('returns empty array for TopCV email with job-item but no job-item-link', () => {
      const html = `<html><body><div class="job-item">topcv</div></body></html>`;
      const jobs = extractAllJobs(html);
      // Falls through to single-job parser but no recognizable fields
      expect(jobs).toHaveLength(0);
    });
  });

  describe('extractAllJobs — Indeed multi-job', () => {
    it('extracts multiple jobs from Indeed email with strong-text-link marker', () => {
      const html = makeIndeedEmailHtml([
        { role: 'Senior Frontend Developer', company: 'Zalo', location: 'Ho Chi Minh City', salary: '15,000,000 VNĐ', url: 'https://vn.indeed.com/rc/clk/dl?jk=test1', daysAgo: 2, description: 'Frontend role' },
        { role: 'React Developer', company: 'TransPerfect', location: 'Ha Noi', salary: '12,000,000 VNĐ', url: 'https://vn.indeed.com/rc/clk/dl?jk=test2', daysAgo: 5, description: 'React role' },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toMatchObject({ role: 'Senior Frontend Developer', company: 'Zalo', source: 'indeed' });
      expect(jobs[1]).toMatchObject({ role: 'React Developer', company: 'TransPerfect', source: 'indeed' });
    });

    it('extracts single job from Indeed email', () => {
      const html = makeIndeedEmailHtml([
        { role: 'Backend Developer', company: 'SHB', location: 'Ha Noi', salary: '18,000,000 VNĐ', url: 'https://vn.indeed.com/rc/clk/dl?jk=test3', daysAgo: 0 },
      ]);
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].role).toBe('Backend Developer');
    });

    it('returns empty array for Indeed email without strong-text-link', () => {
      const html = `<html><body><p>Indeed Job Alert</p><div class="job-item">some job</div></body></html>`;
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(0);
    });
  });

  describe('extractAllJobs — single job fallback', () => {
    it('extracts a single TopCV detail page job', () => {
      const html = `<html><head><title>Test Job - TopCV</title></head><body>
        <div class="job-detail__header">
          <h1 class="job-detail__info--title">Software Engineer</h1>
          <div class="job-detail__info--company">
            <span class="company-name">Test Company</span>
          </div>
        </div>
        <div class="job-detail__meta">
          <div class="meta-item section-salary">
            <span class="job-detail__info--section-content-value">Từ 15 triệu</span>
          </div>
          <div class="meta-item section-location">
            <span class="job-detail__info--section-content-value">Hà Nội</span>
          </div>
        </div>
        topcv job-detail__info
      </body></html>`;
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ role: 'Software Engineer', company: 'Test Company', source: 'topcv' });
    });

    it('extracts a single Indeed detail page job', () => {
      const html = `<html><head><title>Senior Developer - Indeed</title></head><body>
        <div id="jobsearch-ViewjobHeader">
          <h1 data-testid="jobsearch-JobInfoHeader-title"><span>Senior Developer</span></h1>
          <div class="company-header">
            <div data-testid="inlineHeader-companyName" class="company-name">Indeed Co</div>
          </div>
        </div>
        indeed.com
      </body></html>`;
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ role: 'Senior Developer', company: 'Indeed Co', source: 'indeed' });
    });

    it('returns empty array for non-job HTML', () => {
      const html = '<html><body><p>No job content here</p></body></html>';
      const jobs = extractAllJobs(html);
      expect(jobs).toHaveLength(0);
    });
  });

  describe('extractAllJobs — empty/edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(extractAllJobs('')).toHaveLength(0);
    });

    it('returns empty array for malformed HTML', () => {
      expect(extractAllJobs('<unclosed>')).toHaveLength(0);
    });

    it('returns empty array for HTML with only whitespace', () => {
      expect(extractAllJobs('   \n\n  ')).toHaveLength(0);
    });

    it('does not throw on null-like input', () => {
      expect(() => extractAllJobs('null')).not.toThrow();
    });
  });
});
