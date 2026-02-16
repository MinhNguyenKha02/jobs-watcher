import fs from 'fs';
import os from 'os';
import path from 'path';
import { DocxGenerator } from '../../../src/services/generators/docx-generator.js';

describe('DocxGenerator', () => {
  it('creates a DOCX file with content', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-watcher-docx-'));
    const outputPath = path.join(tempDir, 'sample.docx');

    await DocxGenerator.generateFromText('Hello\nWorld', outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  });
});
