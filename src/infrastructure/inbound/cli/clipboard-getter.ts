/**
 * Clipboard getter/setter
 *
 * Default behavior:
 * - production/dev: read real system clipboard via clipboardy
 * - test/fixture mode: use fixture data by setting CLIPBOARD_FIXTURE_MODE=1
 */
import { createHash } from 'crypto';

import clipboardy from 'clipboardy';

type ClipboardFixtureEmails = {
  indeedPlatformPageHtml1: string;
  indeedPlatformPageHtml2: string;
  linkedinPlatformPageHtml1: string;
  linkedinPlatformPageHtml2: string;
};

let lastClipboardHash = '';

function isClipboardFixtureModeEnabled(): boolean {
  return process.env.CLIPBOARD_FIXTURE_MODE === '1';
}

async function loadClipboardFixtures(): Promise<ClipboardFixtureEmails> {
  return import('../../../../tests/__fixtures__/emails.js') as Promise<ClipboardFixtureEmails>;
}

function toHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isHtmlLike(text: string): boolean {
  return /<html|<body|<div|<article|<main|<section/i.test(text);
}

// Simulate clipboard setter for tests: injects raw HTML as clipboard content
export function clipboardSetter(html: string) {
  (global as any).__clipboardJob = html;
}

async function getFixtureClipboard(): Promise<any[]> {
  const {
    indeedPlatformPageHtml1,
    indeedPlatformPageHtml2,
    linkedinPlatformPageHtml1,
    linkedinPlatformPageHtml2,
  } = await loadClipboardFixtures();

  if ((global as any).__clipboardJob) {
    return [(global as any).__clipboardJob];
  }
  return [
    indeedPlatformPageHtml1,
    indeedPlatformPageHtml2,
    linkedinPlatformPageHtml1,
    linkedinPlatformPageHtml2,
  ];
}

export async function clipboardGetter(): Promise<any[]> {
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

  const currentHash = toHash(clipboardText);
  if (currentHash === lastClipboardHash) {
    return [];
  }

  lastClipboardHash = currentHash;
  return [clipboardText];
}
