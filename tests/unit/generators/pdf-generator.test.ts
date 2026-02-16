import fs from 'fs';
import os from 'os';
import path from 'path';
import { PdfGenerator } from '../../../src/services/generators/pdf-generator.js';

describe('PdfGenerator', () => {
  const executablePath = PdfGenerator.resolveExecutablePath();
  const runTest = executablePath ? test : test.skip;

  runTest('creates a PDF file with content', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-watcher-pdf-'));
    const outputPath = path.join(tempDir, 'sample.pdf');

    await PdfGenerator.generateFromText('Hello\nWorld', outputPath, { executablePath });

    expect(fs.existsSync(outputPath)).toBe(true);
    const stats = fs.statSync(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  });
});
