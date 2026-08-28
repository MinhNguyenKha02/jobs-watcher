import {
  topcvDetailFixture,
  topcvDetail2Fixture,
  indeedDetailFixture,
  indeedDetail2Fixture,
} from '../__fixtures__/html-fixture-loader.js';

export interface TopCvEmailMeta {
  location?: string;
  salary?: string;
  deadlineDays?: number;
}

/**
 * TopCV job-alert email (Signal 1). `meta` is opt-in: when provided, the real
 * alert's `.meta-job` block (location / salary / 'Còn N ngày để ứng tuyển') is
 * emitted so s1→doc field-flow GWT cells can assert the full field set.
 */
export function topcvEmailHtmlMany(
  jobs: Array<{ role: string; company: string }>,
  meta?: TopCvEmailMeta
): string {
  const metaBlock = meta
    ? `<div class="meta-job">
            ${meta.salary ? `<div class="text-primary item"><b>${meta.salary}</b></div>` : ''}
            ${meta.location ? `<div class="item">${meta.location}</div>` : ''}
            ${
              meta.deadlineDays
                ? `<div class="item">Còn <strong>${meta.deadlineDays}</strong> ngày để ứng tuyển</div>`
                : ''
            }
          </div>`
    : '';
  const items = jobs
    .map((job) => {
      const encodedUrl = `/viec-lam/${job.role.toLowerCase().replace(/\s+/g, '-')}`;
      return `<a class="job-item-link" href="${encodedUrl}">
          <div class="topcv-job-item">
            <div class="title"><span>${job.role}</span></div>
            <div class="company"><span>${job.company}</span></div>
            ${metaBlock}
          </div>
        </a>`;
    })
    .join('\n');
  return `<html><body>${items}<p>topcv job-item</p></body></html>`;
}

/**
 * TopCV detail page — static real capture (tests/__fixtures__/html/topcv-detail.html).
 * s2a/s2c never parse detail payloads under the htmlToText contract; args are kept
 * for call-site backward compatibility only.
 */
export interface TopCvDetailOptions {
  salary?: string;
  location?: string;
  description?: string;
}

export function topcvDetailHtml(
  _role?: string,
  _company?: string,
  _opts?: TopCvDetailOptions
): string {
  return topcvDetailFixture();
}

/** Static variant #2 — real capture topcv-detail-2.html. */
export function topcvDetail2Html(): string {
  return topcvDetail2Fixture();
}

/**
 * Non-parsable HTML used for negative paths (clipboard trash, skip).
 */
export function nonJobHtml(): string {
  return '<html><body><div class="no-job">not a job posting</div></body></html>';
}

/**
 * LinkedIn SDUi detail page (s2b direct path, LinkedInJobExtractor).
 * Child1 (header/metadata) mirrors the validated capture selectors:
 * company in `[aria-label*="Company,"]`, role in `a[href*="/jobs/view/"]`,
 * location/deadline in a tertiary `<p>` split on `·`, tags as exact-match
 * `<a><span>` texts, apply-button aria-label per easyApply.
 * Child2 is a minimal stable About-the-job box (real captures' child2 is unstable).
 */
export interface LinkedInSduiOptions {
  easyApply?: boolean;
  jobType?: string;
  workLocationType?: string;
}

export function linkedinSduiDetailHtml(
  role: string,
  company: string,
  location = 'Ho Chi Minh City, Vietnam',
  description = `${role} role at ${company}. We are looking for an experienced developer.`,
  opts: LinkedInSduiOptions = {}
): string {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const easyApply = opts.easyApply ?? true;
  const jobType = opts.jobType ?? 'Full-time';
  const workLocationType = opts.workLocationType ?? 'On-site';
  const applyButton = easyApply
    ? '<button aria-label="Easy Apply to this job"><span>Easy Apply</span></button>'
    : '<button aria-label="Apply on company website"><span>Apply</span></button>';
  return `<div data-testid="lazy-column">
  <div>
    <div aria-label="Company, ${company}.">
      <a href="https://www.linkedin.com/company/${slug}">${company}</a>
    </div>
    <p>
      <a href="/jobs/view/1111111111/">${role}</a>
    </p>
    <p>
      <span>${location}</span>
      ·
      <span>2 weeks ago</span>
      ·
      <span>Over 50 applicants</span>
    </p>
    <div>
      <a><svg id="check-small"></svg><span>${workLocationType}</span></a>
      <a><svg id="check-small"></svg><span>${jobType}</span></a>
    </div>
    ${applyButton}
  </div>
  <div>
    <div componentkey="JobDetails_AboutTheJob_abc123">
      <h2>About the job</h2>
      <p><span data-testid="expandable-text-box">${description}</span></p>
    </div>
  </div>
</div>`;
}

/**
 * Indeed Job Alert email (Signal 1, legacy table layout → extractIndeedJobs
 * legacy branch). Item fields beyond role/company/url are additive: omitted
 * fields preserve the historical output exactly.
 */
export interface IndeedEmailItem {
  role: string;
  company: string;
  url: string;
  salary?: string;
  description?: string;
  daysAgo?: string;
  easyApply?: boolean;
}

export function indeedEmailHtmlMany(jobs: Array<IndeedEmailItem>): string {
  const rows = jobs
    .map(
      (job) => `<td class="pb-24" style="padding-bottom:24px">
      <h2><a href="${job.url}">${job.role}</a></h2>
      <div style="padding:0 12px;color:#2d2d2d;font-size:14px;line-height:21px">${job.company}</div>
      <div style="color:#2d2d2d">Ho Chi Minh City</div>
      ${job.salary ? `<strong>${job.salary}</strong>` : ''}
      <div style="padding:0;color:#767676;font-size:14px;line-height:21px">${
        job.description ?? `${job.role} opportunity`
      }</div>
      <div style="font-size:12px;line-height:18px">${job.daysAgo ?? 'Just posted'}</div>
      ${job.easyApply ? '<span>Easily apply</span>' : ''}
    </td>`
    )
    .map((row) => `<tr>${row}</tr>`)
    .join('\n');
  return `<html><body><span class="strong-text-link">Indeed Job Alert</span><table>${rows}</table></body></html>`;
}

/**
 * Indeed JobSearch viewjob detail page — static real capture
 * (tests/__fixtures__/html/indeed-detail.html). Payload-only input for
 * htmlToText at s2c; args kept for call-site backward compatibility only.
 */
export function indeedDetailHtml(_role?: string, _company?: string, _url?: string): string {
  return indeedDetailFixture();
}

/** Static variant #2 — real capture indeed-detail-2.html. */
export function indeedDetail2Html(): string {
  return indeedDetail2Fixture();
}
