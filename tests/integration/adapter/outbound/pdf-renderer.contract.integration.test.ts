import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderPdf } from '../../../../src/infrastructure/outbound/asset-builder/renderer/pdf-renderer.js';
import type { PdfAsset } from '../../../../src/domain/types/asset.js';

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

describe('PRC-010 — PdfRenderer contract (real template + real chromium → temp dir)', () => {
  it('renders a PDF with %%PDF header bytes into the configured output dir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
    try {
      const outputPath = await renderPdf(makeAsset(), tmpDir);
      expect(outputPath).toContain('ats.pdf');
      expect(fs.existsSync(outputPath)).toBe(true);
      const header = fs.readFileSync(outputPath).slice(0, 4).toString();
      expect(header).toBe('%PDF');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates intermediate output directories before writing the PDF', async () => {
    const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-nested-'));
    const deepDir = path.join(nestedDir, 'sub', 'dir');
    try {
      const outputPath = await renderPdf(makeAsset(), deepDir);
      expect(fs.existsSync(outputPath)).toBe(true);
    } finally {
      fs.rmSync(nestedDir, { recursive: true, force: true });
    }
  });

  it('outputs a non-empty PDF file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-size-'));
    try {
      const outputPath = await renderPdf(makeAsset(), tmpDir);
      const stat = fs.statSync(outputPath);
      expect(stat.size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders the candidate name into the intermediate HTML source', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-name-'));
    try {
      await renderPdf(makeAsset(), tmpDir);
      const htmlPath = path.join(tmpDir, 'ats.html');
      expect(fs.existsSync(htmlPath)).toBe(true);
      const html = fs.readFileSync(htmlPath, 'utf-8');
      expect(html).toContain('John Doe');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});