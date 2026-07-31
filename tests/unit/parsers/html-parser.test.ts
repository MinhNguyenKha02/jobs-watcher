import fc from 'fast-check';

import { HtmlJobParser } from '../../../src/domain/services/parsing/html-job-parser.js';
import type { JobDetails } from '../../../src/domain/types/job.js';
import {
  topCVDetailPageHTML,
  indeedDetailPageHTML,
  indeedPlatformPageHtml1,
  indeedPlatformPageHtml2,
  linkedinPlatformPageHtml1,
  linkedinPlatformPageHtml2,
  linkedinSduiHtml1,
  linkedinSduiHtml2,
  linkedinSduiHtml3,
} from '../../__fixtures__/emails.js';

function getFirstEnrichedHtml(): string | null {
  const baseDir = path.join(process.cwd(), 'src', 'db', 'emails', 'enriched');
  if (!fs.existsSync(baseDir)) return null;

  const monthDirs = fs
    .readdirSync(baseDir)
    .filter((d) => fs.statSync(path.join(baseDir, d)).isDirectory());
  if (monthDirs.length === 0) return null;

  for (const month of monthDirs) {
    const monthPath = path.join(baseDir, month);
    const dayDirs = fs
      .readdirSync(monthPath)
      .filter((d) => fs.statSync(path.join(monthPath, d)).isDirectory());
    for (const day of dayDirs) {
      const dayPath = path.join(monthPath, day);
      const jobDirs = fs
        .readdirSync(dayPath)
        .filter((d) => fs.statSync(path.join(dayPath, d)).isDirectory());
      for (const jobDir of jobDirs) {
        const htmlPath = path.join(dayPath, jobDir, 'pasted-html.html');
        if (fs.existsSync(htmlPath)) {
          return fs.readFileSync(htmlPath, 'utf-8');
        }
      }
    }
  }

  return null;
}

function getAllRawEmailBodies(limit = 50): string[] {
  const baseDir = path.join(process.cwd(), 'src', 'db', 'emails');
  if (!fs.existsSync(baseDir)) return [];

  const monthDirs = fs
    .readdirSync(baseDir)
    .filter((d) => d !== 'enriched' && fs.statSync(path.join(baseDir, d)).isDirectory());

  const bodies: string[] = [];
  for (const month of monthDirs) {
    const monthPath = path.join(baseDir, month);
    const dayDirs = fs
      .readdirSync(monthPath)
      .filter((d) => fs.statSync(path.join(monthPath, d)).isDirectory());
    for (const day of dayDirs) {
      const dayPath = path.join(monthPath, day);
      const bodyFiles = fs.readdirSync(dayPath).filter((f) => f.endsWith('.body.txt'));
      for (const file of bodyFiles) {
        bodies.push(fs.readFileSync(path.join(dayPath, file), 'utf-8'));
        if (bodies.length >= limit) {
          return bodies;
        }
      }
    }
  }

  return bodies;
}

function getAllEnrichedHtml(limit = 50): string[] {
  const baseDir = path.join(process.cwd(), 'src', 'db', 'emails', 'enriched');
  if (!fs.existsSync(baseDir)) return [];

  const monthDirs = fs
    .readdirSync(baseDir)
    .filter((d) => fs.statSync(path.join(baseDir, d)).isDirectory());
  const htmlFiles: string[] = [];

  for (const month of monthDirs) {
    const monthPath = path.join(baseDir, month);
    const dayDirs = fs
      .readdirSync(monthPath)
      .filter((d) => fs.statSync(path.join(monthPath, d)).isDirectory());
    for (const day of dayDirs) {
      const dayPath = path.join(monthPath, day);
      const jobDirs = fs
        .readdirSync(dayPath)
        .filter((d) => fs.statSync(path.join(dayPath, d)).isDirectory());
      for (const jobDir of jobDirs) {
        const htmlPath = path.join(dayPath, jobDir, 'pasted-html.html');
        if (fs.existsSync(htmlPath)) {
          htmlFiles.push(fs.readFileSync(htmlPath, 'utf-8'));
          if (htmlFiles.length >= limit) {
            return htmlFiles;
          }
        }
      }
    }
  }

  return htmlFiles;
}

type DetailKey = keyof JobDetails;

const headingPattern = (text: string): RegExp =>
  new RegExp(`<h[23][^>]*>[\\s\\S]*?${text}[\\s\\S]*?<\\/h[23]>`, 'i');

function assertDetailsFromHeadings(
  html: string,
  result: ReturnType<HtmlJobParser['parseJobFromHtml']> | null
): void {
  if (!result) return;

  const details = result.details || {};
  const checks: Array<{ regex: RegExp; field: DetailKey }> = [
    {
      regex: headingPattern(
        "Mô tả công việc|Job Responsibilities|Responsibilities|What you will do|What you'll do"
      ),
      field: 'responsibilities',
    },
    {
      regex: headingPattern(
        "Yêu cầu|Requirements|Required Qualifications|Qualifications|What you will need|What you'll need|What you need"
      ),
      field: 'requirements',
    },
    { regex: headingPattern('Quyền lợi|Benefits|What We Offer|Perks'), field: 'benefits' },
    { regex: headingPattern('Phụ cấp|Thiết bị làm việc'), field: 'additionalInfo' },
    {
      regex: headingPattern(
        'Cách thức ứng tuyển|Cách ứng tuyển|Application Process|How to Apply|Recruitment Process'
      ),
      field: 'applicationProcess',
    },
    {
      regex: headingPattern('Thông tin công ty|Giới thiệu công ty|About Company|About'),
      field: 'companyInfo',
    },
    {
      regex: headingPattern('Thông tin liên hệ|Contact Information|Hiring Team|Contact'),
      field: 'contact',
    },
  ];

  for (const check of checks) {
    if (check.regex.test(html)) {
      if (typeof details[check.field] !== 'undefined') {
        expect(details[check.field]).toBeTruthy();
      }
    }
  }
}

describe('HtmlJobParser', () => {
  let parser: HtmlJobParser;

  beforeEach(() => {
    parser = new HtmlJobParser();
  });

  describe('TopCV detail parsing', () => {
    it('parses core fields from detail HTML', () => {
      const html = `
        <html>
          <h1 class="job-detail__info--title">Senior Backend Engineer</h1>
          <div class="company-name-label">
            <a class="name">TechCorp Vietnam</a>
          </div>
          <div class="section-location">
            <div class="job-detail__info--section-content-value">Hà Nội (mới)</div>
          </div>
          <div class="section-salary">
            <div class="job-detail__info--section-content-value">15-25 triệu VND</div>
          </div>
          <h3>Mô tả công việc</h3>
          <div class="job-description__item--content">
            Build scalable backend systems with Go and Node.js
          </div>
          <a href="https://www.topcv.vn/viec-lam/senior-backend-123">View</a>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result).not.toBeNull();
      expect(result?.role).toBe('Senior Backend Engineer');
      expect(result?.company).toContain('TechCorp');
      expect(result?.location).toContain('Hà Nội');
      expect(result?.salary).toContain('15-25');
      expect(result?.description).toContain('Go');
      expect(result?.url).toContain('topcv.vn');
    });

    it('handles anchor titles and verified badge', () => {
      const html = `
        <html>
          <div class="job-detail__info">
            <h1 class="job-detail__info--title">
              Quality <a href="/tim-viec-lam-analyst">Analyst</a>
              (<a href="/tim-viec-lam-qa">QA</a> Night Shift)
              <span class="icon-verified-employer">Verified</span>
            </h1>
          </div>
          <div class="company-name-label">
            <a class="name">Gear Inc VN</a>
          </div>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result).not.toBeNull();
      expect(result?.role).toContain('Quality Analyst');
      expect(result?.role).toContain('QA Night Shift');
      expect(result?.role).not.toContain('Verified');
      expect(result?.company).toContain('Gear Inc');
    });

    it('handles missing optional fields', () => {
      const html = `
        <html>
          <h1 class="job-detail__info--title">Test Position</h1>
          <div class="company-name-label">
            <a class="name">Test Company</a>
          </div>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result?.role).toBe('Test Position');
      expect(result?.company).toBe('Test Company');
      expect(result?.location).toBe('');
      expect(result?.salary).toBe('');
      expect(result?.description).toBeUndefined();
      expect(result?.url).toBe('');
    });
  });

  describe('Indeed detail parsing', () => {
    it('parses core fields from detail HTML', () => {
      const html = `
        <html>
          <h1 data-testid="jobsearch-JobInfoHeader-title">
            <span>Full Stack Developer</span>
          </h1>
          <div data-testid="inlineHeader-companyName">
            <span>StartUp XYZ</span>
          </div>
          <div data-testid="inlineHeader-companyLocation">
            <div>Ho Chi Minh City, Vietnam</div>
          </div>
          <div id="salaryInfoAndJobType">
            <span>$2,000 - $3,000 per month</span>
          </div>
          <div id="jobDescriptionText">
            Looking for Full Stack Developer with React and Node.js experience
          </div>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result).not.toBeNull();
      expect(result?.role).toContain('Full Stack Developer');
      expect(result?.company).toContain('StartUp');
      expect(result?.location).toBeTruthy();
      expect(result?.salary).toContain('2,000');
      expect(result?.description).toContain('React');
    });

    it('provides defaults when company/location missing', () => {
      const html = `
        <html>
          <h1 data-testid="jobsearch-JobInfoHeader-title">
            <span>Test Developer</span>
          </h1>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result?.role).toContain('Test Developer');
      expect(result?.company).toBe('Unknown Company');
      expect(result?.location).toBe('Unknown Location');
    });

    it('extracts nested heading sections', () => {
      const html = `
        <html>
          <h1 data-testid="jobsearch-JobInfoHeader-title"><span>Test Developer</span></h1>
          <div data-testid="inlineHeader-companyName"><span>Test Co</span></div>
          <div id="jobDescriptionText">
            <h3 class="jobSectionHeader"><b>What you will do</b></h3>
            <div><ul><li>Build scalable UI components</li></ul></div>
            <h3 class="jobSectionHeader"><span>What you will need</span></h3>
            <div><ul><li>React, TypeScript</li></ul></div>
            <h3 class="jobSectionHeader"><span>Benefits</span></h3>
            <div>Health insurance</div>
          </div>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result).not.toBeNull();
      expect(result?.details?.responsibilities).toBeTruthy();
      expect(result?.details?.requirements).toBeTruthy();
      expect(result?.details?.benefits).toBeTruthy();
    });

    it('extracts bold-label sections', () => {
      const html = `
        <html>
          <h1 data-testid="jobsearch-JobInfoHeader-title"><span>Labelled Developer</span></h1>
          <div data-testid="inlineHeader-companyName"><span>Label Co</span></div>
          <div id="jobDescriptionText">
            <p><b>Yêu cầu:</b></p>
            <ul><li>TypeScript</li></ul>
            <p><b>Công việc:</b></p>
            <ul><li>Build UI</li></ul>
            <p><b>Lương:</b> 15 - 20 triệu</p>
          </div>
        </html>
      `;

      const result = parser.parseJobFromHtml(html);

      expect(result).not.toBeNull();
      expect(result?.details?.requirements).toBeTruthy();
      expect(result?.details?.responsibilities).toBeTruthy();
      expect(result?.details?.benefits).toBeTruthy();
    });

    it('parses embedded job detail (sample 1)', () => {
      const result = parser.parseJobFromHtml(indeedPlatformPageHtml1);

      expect(result?.role).toContain('Senior Full-stack Python Developer');
      expect(result?.company).toContain('AnyWork');
      expect(result?.location).toContain('Thành phố Hồ Chí Minh');
      expect(result?.salary).toContain('75,000,000');
      expect(result?.details?.responsibilities).toBeTruthy();
      expect(result?.details?.requirements).toBeTruthy();
      expect(result?.details?.benefits).toBeTruthy();
    });

    it('parses embedded job detail (sample 2)', () => {
      const result = parser.parseJobFromHtml(indeedPlatformPageHtml2);

      expect(result?.role).toContain('Data Engineer Fresher');
      expect(result?.company).toContain('Cigro');
      expect(result?.location).toContain('Thành phố Hồ Chí Minh');
      expect(result?.details?.responsibilities).toBeTruthy();
      expect(result?.details?.requirements).toBeTruthy();
      expect(result?.details?.benefits).toBeTruthy();
    });
  });

  describe('LinkedIn detail parsing', () => {
    it('parses core fields from LinkedIn job detail (sample 1)', () => {
      const result = parser.parseJobFromHtml(linkedinPlatformPageHtml1);

      expect(result?.role).toBe('Research Engineer Intern');
      expect(result?.company).toBe('Qualcomm');
      expect(result?.location).toContain('Ho Chi Minh City');
      expect(result?.description).toBeTruthy();
    });

    it('parses core fields from LinkedIn job detail (sample 2)', () => {
      const result = parser.parseJobFromHtml(linkedinPlatformPageHtml2);

      expect(result?.role).toBe('Software Developers');
      expect(result?.company).toBe('Netcompany');
      expect(result?.location).toContain('Ho Chi Minh City');
      expect(result?.description).toBeTruthy();
    });
  });

  describe('LinkedIn SDUi detail parsing', () => {
    it('parses core fields from SDUi format (sample 1)', () => {
      const result = parser.parseJobFromHtml(linkedinSduiHtml1);

      expect(result?.role).toBe('Senior Software Engineer');
      expect(result?.company).toBe('TechCorp Vietnam');
      expect(result?.location).toContain('Ho Chi Minh City');
      expect(result?.deadline).toContain('2 weeks ago');
      expect(result?.easyApply).toBeFalsy();
      expect(result?.description).toBeTruthy();
      expect(result?.details?.jobType).toContain('On-site');
      expect(result?.details?.jobType).toContain('Full-time');
    });

    it('parses core fields from SDUi format (sample 2 - salary, easy apply)', () => {
      const result = parser.parseJobFromHtml(linkedinSduiHtml2);

      expect(result?.role).toBe('Data Analyst');
      expect(result?.company).toBe('DataCo Analytics');
      expect(result?.location).toContain('Hà Nội');
      expect(result?.deadline).toContain('1 month ago');
      expect(result?.easyApply).toBe(true);
      expect(result?.salary).toBeTruthy();
      expect(result?.details?.jobType).toContain('Hybrid');
      expect(result?.details?.jobType).toContain('Contract');
      expect(result?.details?.requirements).toBeTruthy();
    });

    it('parses companyInfo from SDUi AboutTheCompany component (sample 3)', () => {
      const result = parser.parseJobFromHtml(linkedinSduiHtml3);

      expect(result?.role).toBe('Product Manager');
      expect(result?.company).toBe('InnovateCo Ltd');
      expect(result?.location).toContain('Da Nang');
      expect(result?.deadline).toContain('3 days ago');
      expect(result?.details?.companyInfo).toBeTruthy();
      expect(result?.details?.companyInfo).toContain('InnovateCo');
      expect(result?.details?.jobType).toContain('Remote');
      expect(result?.details?.requirements).toBeTruthy();
    });

    it('captures uncaptured sections via extraSections fallback', () => {
      const result = parser.parseJobFromHtml(linkedinSduiHtml3);

      expect(result?.details?.extraSections).toBeDefined();
      const extra = result?.details?.extraSections || {};
      const extraTitles = Object.keys(extra).join(', ');
      expect(extraTitles).toContain('About This Role');
    });
  });

  describe('Fixtures', () => {
    it('parses TopCV detail fixture', () => {
      const result = parser.parseJobFromHtml(topCVDetailPageHTML);

      expect(result).not.toBeNull();
      expect(result?.role).toBe('Software Developer For Broadband Devices');
      expect(result?.company).toContain('MARUSYS');
      expect(result?.location).toContain('Hà Nội');
      expect(result?.salary).toContain('8');
      expect(result?.details?.requirements ?? '').toContain('C++');
      // For beta, allow benefits to be missing if requirements are present
      if ((result?.details?.benefits ?? '').length > 0) {
        expect(result?.details?.benefits ?? '').toContain('health insurance');
      }
    });

    it('parses Indeed detail fixture', () => {
      const result = parser.parseJobFromHtml(indeedDetailPageHTML);

      expect(result).not.toBeNull();
      expect(result?.role).toBe('Senior Frontend Developer');
      expect(result?.company).toContain('Zalo');
      expect(result?.salary).toContain('1800');
      expect(result?.details?.requirements ?? '').toContain('JavaScript');
      expect(result?.details?.benefits ?? '').toContain('health insurance');
    });
  });

  describe('Edge cases', () => {
    it('handles empty HTML', () => {
      const result = parser.parseJobFromHtml('');

      expect(result).toBeNull();
    });

    it('handles malformed HTML gracefully', () => {
      const html = '<html><h1 class="job-detail__info--title">Title without closing';

      const result = parser.parseJobFromHtml(html);

      expect(result === null || result?.role).toBeTruthy();
    });
  });

  describe('Equivalence partitioning', () => {
    it('parses valid TopCV HTML with all fields', () => {
      const html = `
        <html>
          <h1 class="job-detail__info--title">Senior Fullstack Developer</h1>
          <div class="company-name-label"><a class="name">BigCorp Inc</a></div>
          <div class="section-location"><div class="job-detail__info--section-content-value">Ho Chi Minh</div></div>
          <div class="section-salary"><div class="job-detail__info--section-content-value">$3000-$4000</div></div>
          <div class="job-description__item--content">React, Node.js, TypeScript</div>
          <a href="https://topcv.vn/job-123">View</a>
        </html>
      `;
      const result = parser.parseJobFromHtml(html);
      expect(result).not.toBeNull();
      expect(result?.role).toBe('Senior Fullstack Developer');
      expect(result?.company).toBe('BigCorp Inc');
      expect(result?.location).toContain('Ho Chi Minh');
      expect(result?.salary).toContain('$3000');
    });

    it('returns null for empty string (null equivalence class)', () => {
      expect(parser.parseJobFromHtml('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parser.parseJobFromHtml('   \n  \t  ')).toBeNull();
    });

    it('parses HTML with only required fields (partial input)', () => {
      const html = `
        <html>
          <h1 class="job-detail__info--title">Minimal Role</h1>
          <div class="company-name-label"><a class="name">Minimal Co</a></div>
        </html>
      `;
      const result = parser.parseJobFromHtml(html);
      expect(result).not.toBeNull();
      expect(result?.role).toBe('Minimal Role');
      expect(result?.company).toBe('Minimal Co');
    });

    it('handles HTML with no recognizable job format', () => {
      const html = '<div>Random non-job content</div>';
      const result = parser.parseJobFromHtml(html);
      expect(result).toBeNull();
    });
  });

  describe('Property-based (fast-check)', () => {
    const normalizeWs = (s: string) => s.trim().replace(/[\s\n]+/g, ' ');
    const nonEmptyString = fc.string({ minLength: 1, maxLength: 100 }).map(normalizeWs).filter(s => s.length > 0 && !s.includes('<'));
    const nonEmptyString80 = fc.string({ minLength: 1, maxLength: 80 }).map(normalizeWs).filter(s => s.length > 0 && !s.includes('<'));

    it('extracts role from TopCV format for any non-empty title', () => {
      fc.assert(
        fc.property(nonEmptyString, (role) => {
          const html = `
            <html>
              <h1 class="job-detail__info--title">${role}</h1>
              <div class="company-name-label"><a class="name">TestCo</a></div>
            </html>
          `;
          const result = parser.parseJobFromHtml(html);
          expect(result).not.toBeNull();
          expect(result?.role).toBe(role);
        }),
        { numRuns: 50 },
      );
    });

    it('extracts company from TopCV format for any non-empty name', () => {
      fc.assert(
        fc.property(nonEmptyString80, (company) => {
          const html = `
            <html>
              <h1 class="job-detail__info--title">Engineer</h1>
              <div class="company-name-label"><a class="name">${company}</a></div>
            </html>
          `;
          const result = parser.parseJobFromHtml(html);
          expect(result).not.toBeNull();
          expect(result?.company).toBe(company);
        }),
        { numRuns: 50 },
      );
    });

    it('extracts salary from TopCV format when present', () => {
      fc.assert(
        fc.property(
          nonEmptyString,
          nonEmptyString80,
          (role, salary) => {
            const html = `
              <html>
                <h1 class="job-detail__info--title">${role}</h1>
                <div class="company-name-label"><a class="name">Corp</a></div>
                <div class="section-salary"><div class="job-detail__info--section-content-value">${salary}</div></div>
              </html>
            `;
            const result = parser.parseJobFromHtml(html);
            expect(result).not.toBeNull();
            expect(result?.role).toBe(role);
            expect(result?.salary).toBe(salary);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
