/**
 * Clipboard getter/setter
 *
 * Default behavior:
 * - production/dev: read real system clipboard via clipboardy
 * - test/fixture mode: use fixture data by setting CLIPBOARD_FIXTURE_MODE=1
 *
 * Peek semantics: every call returns the current clipboard content.
 * No dedup hash — [p] preview must not consume the copy that a later
 * [c]/[i] needs ([o]->[p]->[c] reuse on the same copy).
 */
import clipboardy from 'clipboardy';

type ClipboardFixtureEmails = {
  indeedPlatformPageHtml1: string;
  indeedPlatformPageHtml2: string;
  linkedinPlatformPageHtml1: string;
  linkedinPlatformPageHtml2: string;
};

function isClipboardFixtureModeEnabled(): boolean {
  return process.env.CLIPBOARD_FIXTURE_MODE === '1';
}

async function loadClipboardFixtures(): Promise<ClipboardFixtureEmails> {
  return import('../../../../tests/__fixtures__/emails.js') as Promise<ClipboardFixtureEmails>;
}

function isHtmlLike(text: string): boolean {
  return /<html|<body|<div|<article|<main|<section/i.test(text);
}

declare global {
  // eslint-disable-next-line no-var
  var __clipboardJob: string | undefined;
}

// Simulate clipboard setter for tests: injects raw HTML as clipboard content
export function clipboardSetter(html: string) {
  global.__clipboardJob = html;
}

async function getFixtureClipboard(): Promise<string[]> {
  const {
    indeedPlatformPageHtml1,
    indeedPlatformPageHtml2,
    linkedinPlatformPageHtml1,
    linkedinPlatformPageHtml2,
  } = await loadClipboardFixtures();

  if (global.__clipboardJob) {
    return [global.__clipboardJob];
  }
  return [
    indeedPlatformPageHtml1,
    indeedPlatformPageHtml2,
    linkedinPlatformPageHtml1,
    linkedinPlatformPageHtml2,
  ];
}

export async function clipboardGetter(): Promise<string[]> {
  const fixtureMode = isClipboardFixtureModeEnabled();

  if (fixtureMode) {
    return getFixtureClipboard();
  }

  const clipboardText = (await clipboardy.read()).trim();
  if (!clipboardText) {
    return [];
  }

  if (!isHtmlLike(clipboardText)) {
    return [];
  }

  return [clipboardText];
}
