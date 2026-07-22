import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderPdf } from '../../../src/infrastructure/outbound/asset-builder/pdf-renderer.js' ;
import type { ApplicationAsset } from '../../../src/domain/types/profile-normalized.js' ;

function makeAsset(overrides?: Partial<ApplicationAsset>): ApplicationAsset {
  return {
    jobId: 'test-001',
    jobTitle: 'Backend Developer',
    company: 'Acme Corp',
    sections: [],
    matchedSkills: ['Node.js', 'PostgreSQL'],
    skillGroups: [
      { label: 'Frameworks', skills: ['Node.js', 'Express.js'] },
      { label: 'Languages', skills: ['TypeScript'] },
    ],
    skillGaps: [],
    relevanceScore: 0,
    evidenceMappings: [],
    draftedAt: '2025-01-01T00:00:00.000Z',
    profileHash: '',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1 234 567 890',
    location: 'New York, USA',
    experience: [],
    education: [],
    projects: [],
    ...overrides,
  };
}

describe('renderPdf', () => {
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
