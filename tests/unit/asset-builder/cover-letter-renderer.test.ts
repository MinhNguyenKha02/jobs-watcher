import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderCoverLetter } from '../../../src/infrastructure/outbound/asset-builder/cover-letter-renderer.js' ;
import type { ApplicationAsset } from '../../../src/domain/types/profile-normalized.js' ;

function makeAsset(overrides?: Partial<ApplicationAsset>): ApplicationAsset {
  return {
    jobId: 'test-001',
    jobTitle: 'Backend Developer',
    company: 'Acme Corp',
    sections: [],
    matchedSkills: [],
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

describe('renderCoverLetter', () => {
  it('renders cover letter with candidate name and target company', () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
    try {
      const outputPath = renderCoverLetter(asset, tmpDir);
      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf-8');

      expect(content).toContain('Cover Letter');
      expect(content).toContain('John Doe');
      expect(content).toContain('Acme Corp');
      expect(content).toContain('Backend Developer');
      expect(content).toContain('john@example.com');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders with minimal asset data', () => {
    const asset = makeAsset({
      firstName: 'Minh',
      lastName: '',
      email: '',
      phone: '',
      location: '',
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
    try {
      const outputPath = renderCoverLetter(asset, tmpDir);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('Minh');
      expect(content).not.toContain('undefined');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates intermediate directories', () => {
    const asset = makeAsset();
    const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-nested-'));
    const deepDir = path.join(nestedDir, 'sub', 'dir');
    try {
      const outputPath = renderCoverLetter(asset, deepDir);
      expect(fs.existsSync(outputPath)).toBe(true);
    } finally {
      fs.rmSync(nestedDir, { recursive: true, force: true });
    }
  });

  it('throws when template file is missing', () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
    try {
      expect(() =>
        renderCoverLetter(asset, tmpDir, '/nonexistent/template.hbs')
      ).toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
