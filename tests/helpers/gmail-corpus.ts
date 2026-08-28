import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface GmailMetaRecord {
  messageId: string;
  body: string;
}

const corpusCache = new Map<string, GmailMetaRecord[]>();

function loadCorpusRaw(name: string): GmailMetaRecord[] {
  const cached = corpusCache.get(name);
  if (cached) return cached;
  const raw = readFileSync(
    join(import.meta.dirname, '..', 'fixtures', `${name}-gmailmeta.json`),
    'utf8'
  );
  const parsed = JSON.parse(raw) as GmailMetaRecord[];
  corpusCache.set(name, parsed);
  return parsed;
}

/**
 * Single source for *gmailmeta few (topcv|indeed) 2 types — used by jobs-extractor corpus owners,
 * webhook contract S1 and future e2e gmail posts. No inline readFileSync elsewhere.
 */
export function loadGmailCorpusFew(name: 'topcv' | 'indeed', count = 2): GmailMetaRecord[] {
  const corpus = loadCorpusRaw(name);
  return corpus.slice(0, count);
}

export function loadGmailCorpusAll(name: 'topcv' | 'indeed'): GmailMetaRecord[] {
  return loadCorpusRaw(name);
}

export function pickGmailBodyFew(
  messageId: string,
  topcvFew: GmailMetaRecord[],
  indeedFew: GmailMetaRecord[]
): string {
  if (/indeed/i.test(messageId)) return indeedFew[0]?.body ?? '';
  if (/topcv/i.test(messageId)) return topcvFew[0]?.body ?? '';
  const all = [...topcvFew, ...indeedFew];
  if (all.length === 0) return '';
  const idx = Math.abs(hashCode(messageId)) % all.length;
  return all[idx].body;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}
