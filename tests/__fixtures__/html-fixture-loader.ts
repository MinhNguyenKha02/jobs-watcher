import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const HTML_FIXTURE_DIR = join(import.meta.dirname, 'html');

export function loadHtmlFixture(name: string): string {
  return readFileSync(join(HTML_FIXTURE_DIR, `${name}.html`), 'utf8');
}

export const linkedinDetailFixture = (): string => loadHtmlFixture('linkedin-detail');
export const linkedinDetailEasyApplyFixture = (): string =>
  loadHtmlFixture('linkedin-detail-easyapply');
export const topcvDetailFixture = (): string => loadHtmlFixture('topcv-detail');
export const topcvDetail2Fixture = (): string => loadHtmlFixture('topcv-detail-2');
export const indeedDetailFixture = (): string => loadHtmlFixture('indeed-detail');
export const indeedDetail2Fixture = (): string => loadHtmlFixture('indeed-detail-2');
