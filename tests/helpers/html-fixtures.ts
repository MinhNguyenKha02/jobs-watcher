export function emailHtmlFor(role: string, company: string): string {
  const encodedUrl = `/viec-lam/${role.toLowerCase().replace(/\s+/g, '-')}`;
  return `<html><body>
    <a class="job-item-link" href="${encodedUrl}">
      <div class="topcv-job-item">
        <div class="title"><span>${role}</span></div>
        <div class="company"><span>${company}</span></div>
        <div>Hà Nội</div>
      </div>
    </a>
    <p>topcv job-item</p>
  </body></html>`;
}

export function detailHtmlFor(role: string, company: string): string {
  return `<div class="job-detail__info--title"><h1>${role}</h1></div>`
    + `<div class="company-name-label"><a class="name">${company}</a></div>`
    + '<div>topcv</div>';
}
