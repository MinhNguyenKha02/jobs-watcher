import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ProfileRetrievalAdapter } from '../../../src/domain/profile/profile-retrieval-adapter.js' ;
import type { JobLifecycleDocument } from '../../../src/domain/types/job-lifecycle.js' ;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORPUS_DIR = path.resolve(__dirname, '../../regression/profile/corpus');

describe('ProfileRetrievalAdapter Integration', () => {
  let adapter: ProfileRetrievalAdapter;
  let outputDir: string;

  beforeAll(async () => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pra-'));
    adapter = new ProfileRetrievalAdapter(outputDir);
  }, 120000);

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  describe('INT-014: full pipeline returns PDF path', () => {
    const corpusFiles = fs.readdirSync(CORPUS_DIR)
      .filter(f => f.endsWith('.json'))
      .slice(0, 2);

    corpusFiles.forEach(file => {
      const stem = path.basename(file, '.json');
      it(`produces valid PDF from ${stem}`, async () => {
        const job = JSON.parse(
          fs.readFileSync(path.join(CORPUS_DIR, file), 'utf-8')
        ) as JobLifecycleDocument;

        const pdfPath = await adapter.retrieve(job);
        expect(pdfPath).toContain('ats.pdf');
        expect(fs.existsSync(pdfPath)).toBe(true);
        expect(fs.readFileSync(pdfPath).slice(0, 4).toString()).toBe('%PDF');
      }, 60000);
    });
  });
});
