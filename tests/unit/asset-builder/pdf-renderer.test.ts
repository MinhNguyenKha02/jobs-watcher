import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { renderPdf } from '../../../src/infrastructure/outbound/asset-builder/renderer/pdf-renderer.js' ;
import type { PdfAsset } from '../../../src/domain/types/asset.js' ;

const hasPlaywright = (() => {
  try {
    const execPath = process.env.CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
    return fs.existsSync(execPath);
  } catch {
    return false;
  }
})();

function makeAsset(overrides?: Partial<PdfAsset>): PdfAsset {
  return {
    name: 'John Doe',
    contact: {
      email: 'john@example.com',
      phone: '+1 234 567 890',
      location: 'New York, USA',
    },
    skillGroups: [
      { label: 'Frameworks', skills: ['Node.js', 'Express.js'] },
      { label: 'Languages', skills: ['TypeScript'] },
    ],
    experiences: [],
    education: [],
    projects: [],
    ...overrides,
  };
}

const describePdf = hasPlaywright ? describe : describe.skip;

describePdf('renderPdf', () => {
  it('generates a PDF file with proper header bytes', async () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
    try {
      const outputPath = await renderPdf(asset, tmpDir);
      expect(outputPath).toContain('ats.pdf');
      expect(fs.existsSync(outputPath)).toBe(true);
      const header = fs.readFileSync(outputPath).slice(0, 4).toString();
      expect(header).toBe('%PDF');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates intermediate directories', async () => {
    const asset = makeAsset();
    const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-nested-'));
    const deepDir = path.join(nestedDir, 'sub', 'dir');
    try {
      const outputPath = await renderPdf(asset, deepDir);
      expect(fs.existsSync(outputPath)).toBe(true);
    } finally {
      fs.rmSync(nestedDir, { recursive: true, force: true });
    }
  });

  it('outputs a non-empty file', async () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-size-'));
    try {
      const outputPath = await renderPdf(asset, tmpDir);
      const stat = fs.statSync(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders candidate name in the HTML output', async () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-name-'));
    try {
      await renderPdf(asset, tmpDir);
      const htmlPath = path.join(tmpDir, 'ats.html');
      expect(fs.existsSync(htmlPath)).toBe(true);
      const html = fs.readFileSync(htmlPath, 'utf-8');
      expect(html).toContain('John Doe');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
