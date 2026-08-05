export function topcvEmailHtmlMany(
  jobs: Array<{ role: string; company: string }>,
): string {
  const items = jobs
    .map((job) => {
      const encodedUrl = `/viec-lam/${job.role.toLowerCase().replace(/\s+/g, '-')}`;
      return `<a class="job-item-link" href="${encodedUrl}">
          <div class="topcv-job-item">
            <div class="title"><span>${job.role}</span></div>
            <div class="company"><span>${job.company}</span></div>
            <div>Hà Nội</div>
          </div>
        </a>`;
    })
    .join('\n');
  return `<html><body>${items}<p>topcv job-item</p></body></html>`;
}

/**
 * Full TopCV detail page — role/company plus a TypeScript-flavoured
 * description block. The commonly duplicated `htmlFor`/`makeTopCvHtml`
 * helper form across the integration suite.
 */
export interface TopCvDetailOptions {
  salary?: string;
  location?: string;
  description?: string;
}

export function topcvDetailHtml(
  role: string,
  company: string,
  opts: TopCvDetailOptions = {},
): string {
  const description = opts.description ?? 'We need a TypeScript developer with JavaScript skills';
  const meta = [
    opts.salary
      ? '<div class="meta-item section-salary"><span class="job-detail__info--section-content-value">'
        + opts.salary + '</span></div>'
      : '',
    opts.location
      ? '<div class="meta-item section-location"><span class="job-detail__info--section-content-value">'
        + opts.location + '</span></div>'
      : '',
  ].filter(Boolean).join('');

  return '<div class="job-detail__info--title"><h1>' + role + '</h1></div>'
    + '<div class="company-name-label"><a class="name">' + company + '</a></div>'
    + '<div>topcv</div>'
    + '<p>TypeScript</p>'
    + (meta ? '<div class="job-detail__meta">' + meta + '</div>' : '')
    + '<div class="job-description__item"><h3>Mô tả công việc</h3>'
    + '<div class="job-description__item--content">' + description + '</div>'
    + '</div>';
}

/**
 * Non-parsable HTML used for negative paths (clipboard trash, skip).
 */
export function nonJobHtml(): string {
  return '<html><body><div class="no-job">not a job posting</div></body></html>';
}

/**
 * LinkedIn SDUI detail page (Signal 2 for the operator `[i]` direct path).
 * Mirrors the selectors in tests/__fixtures__/emails/sdui.ts and
 * parseLinkedInSdui: role in `a[href*="/jobs/view/"]`, company in
 * `[aria-label*="Company,"]`, description in
 * `[componentkey*="JobDetails_TheJob"] + [data-testid="expandable-text-box"]`.
 */
export function linkedinSduiDetailHtml(
  role: string,
  company: string,
  location = 'Ho Chi Minh City, Vietnam',
  description = `${role} role at ${company}. We are looking for an experienced developer.`,
): string {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `<div data-component-type="LazyColumn">
  <div aria-label="Company, ${company}.">
    <a href="https://www.linkedin.com/company/${slug}">${company}</a>
  </div>
  <h1><a href="/jobs/view/1111111111/">${role}</a></h1>
  <div>
    <span>${location}</span>
    <span>·</span>
    <span>2 weeks ago</span>
    <span>·</span>
    <span>Over 50 applicants</span>
  </div>
  <button aria-label="Easy Apply to this job">Easy Apply</button>
  <div class="job-details-fit-level-preferences">
    <button><strong><li-icon type="check"></li-icon> Full-time</strong></button>
  </div>
  <div componentkey="JobDetails_AboutTheJob_abc123">
    <h2>About the job</h2>
    <span data-testid="expandable-text-box">${description}</span>
  </div>
</div>`;
}

/**
 * Indeed Job Alert email (Signal 1 for the BROWSER_AUTO / extraction path).
 * role + url come from `h2 > a[href*=viewjob]`; company from the trailing div.
 */
export function indeedEmailHtmlMany(
  jobs: Array<{ role: string; company: string; url: string }>,
): string {
  const rows = jobs
    .map((job) => `<td class="pb-24" style="padding-bottom:24px">
      <h2><a href="${job.url}">${job.role}</a></h2>
      <table>
        <tr><td style="padding:0 12px;color:#2d2d2d;font-size:14px;line-height:21px">${job.company}</td></tr>
      </table>
      <div style="color:#2d2d2d">Ho Chi Minh City</div>
      <div style="padding:0;color:#767676;font-size:14px;line-height:21px">${job.role} opportunity</div>
      <div style="font-size:12px;line-height:18px">Just posted</div>
    </td>`)
    .map((row) => `<tr>${row}</tr>`)
    .join('\n');
  return `<html><body><span class="strong-text-link">Indeed Job Alert</span><table>${rows}</table></body></html>`;
}

/**
 * Indeed JobSearch viewjob detail page (Signal 2 for the BROWSER_AUTO /
 * playwright extraction result). Mirrors the shared __fixtures__ selectors:
 * `jobsearch-JobInfoHeader-title`, `inlineHeader-companyName`.
 */
export function indeedDetailHtml(
  role: string,
  company: string,
  url = 'https://vn.indeed.com/viewjob?jk=000000000000',
): string {
  return `<html><body>
<div id="jobsearch-ViewjobHeader">
  <h1 data-testid="jobsearch-JobInfoHeader-title"><span>${role}</span></h1>
  <div class="company-header">
    <div data-testid="inlineHeader-companyName">${company}</div>
    <div data-testid="inlineHeader-companyLocation">Ho Chi Minh City</div>
  </div>
  <div id="salaryInfoAndJobType">
    <span>$1000 - $1500 a month</span>
  </div>
</div>
<div id="jobDescriptionText" class="job-description-section">
  <p>${role} role at ${company}. We need TypeScript experience. ${url}</p>
</div>
</body></html>`;
}