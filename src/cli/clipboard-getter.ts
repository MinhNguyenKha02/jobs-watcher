/**
 * Clipboard getter/setter
 *
 * Default behavior:
 * - production/dev: read real system clipboard via clipboardy
 * - test/fixture mode: use fixture data by setting CLIPBOARD_FIXTURE_MODE=1
 */
import { createHash } from 'crypto';

import clipboardy from 'clipboardy';

import {
  indeedPlatformPageHtml1,
  indeedPlatformPageHtml2,
  linkedinPlatformPageHtml1,
  linkedinPlatformPageHtml2,
} from '../../tests/__fixtures__/emails.js';

let lastClipboardHash = '';

function toHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isHtmlLike(text: string): boolean {
  return /<html|<body|<div|<article|<main|<section/i.test(text);
}

// Simulate clipboard setter for tests: injects a fixture job by name
export function clipboardSetter(fixtureName: string) {
  const fixtures: Record<string, string> = {
    indeed1: indeedPlatformPageHtml1,
    indeed2: indeedPlatformPageHtml2,
    linkedin1: linkedinPlatformPageHtml1,
    linkedin2: linkedinPlatformPageHtml2,
  };
  if (!(fixtureName in fixtures)) throw new Error(`Unknown fixture: ${fixtureName}`);
  (global as any).__clipboardJob = fixtures[fixtureName];
}

async function getFixtureClipboard(): Promise<any[]> {
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
  const fixtureMode = process.env.CLIPBOARD_FIXTURE_MODE === '1' || process.env.NODE_ENV === 'test';

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
