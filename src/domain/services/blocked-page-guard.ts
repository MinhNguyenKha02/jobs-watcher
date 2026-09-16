/**
 * Anti-bot block-page classifier (pure domain rule, zero deps).
 *
 * Single canonical function: matches denial semantics only — never mere challenge telemetry.
 * A soft-challenged page that still carries job content (e.g. Indeed `challenge-loaded` / captcha
 * jsv-ping bootstrap JS) must NOT match; a hard edge block (denial text + Ray ID, no job body) must.
 * Returns the normalized matched marker (prom-safe label, ≤12 fixed values) or null.
 * Consumed by the extraction scheduler over `BrowserPort` outcomes; never by ingestor s2
 * (ingestor only normalises via `htmlToText`).
 */
const BLOCKED_CONTENTS =
  /access denied|attention required|request has been blocked|you have been blocked|ray id for this request|just a moment|verify you are human|unusual traffic|challenges\.cloudflare\.com|cf-challenge|challenge-form|__cf_chl/i;

export function matchBlockedContents(html: string): string | null {
  if (!html || !html.trim()) return null;
  const hit = BLOCKED_CONTENTS.exec(html);
  if (!hit) return null;
  return hit[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export class AntiBotBlockedError extends Error {
  readonly url: string;
  readonly marker: string;

  constructor(url: string, marker = 'unknown') {
    super(`Anti-bot block page detected for ${url} (marker: ${marker})`);
    this.name = 'AntiBotBlockedError';
    this.url = url;
    this.marker = marker;
  }
}
