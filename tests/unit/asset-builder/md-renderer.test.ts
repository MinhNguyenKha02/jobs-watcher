import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { renderAts } from '../../../src/infrastructure/outbound/asset-builder/md-renderer.js' ;
import type { ApplicationAsset } from '../../../src/domain/types/profile-normalized.js' ;

function makeAsset(overrides?: Partial<ApplicationAsset>): ApplicationAsset {
  return {
    jobId: 'test-001',
    jobTitle: 'Backend Developer',
    company: 'Acme Corp',
    sections: [],
    matchedSkills: ['Node.js', 'PostgreSQL', 'Docker', 'TypeScript', 'REST API'],
    skillGroups: [
      { label: 'Frameworks', skills: ['Node.js', 'Express.js'] },
      { label: 'Languages', skills: ['TypeScript', 'Python'] },
      { label: 'Databases', skills: ['PostgreSQL', 'MongoDB'] },
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
    linkedin: 'https://linkedin.com/in/john',
    github: 'https://github.com/john',
    experience: [
      {
        title: 'Senior Developer',
        company: 'Tech Co',
        startDate: '2020-01',
        endDate: '2023-12',
        description: 'Built microservices\nLed team',
      },
    ],
    education: [
      { degree: 'BS', school: 'MIT', year: '2020' },
    ],
    projects: [
      {
        title: 'Platform X',
        description: 'A cloud platform',
        techStack: { backend_framework: ['Node.js'], infrastructure: ['Docker'] },
        responsibilities: ['Built the API'],
        outcomes: ['Reduced latency'],
      },
    ],
    ...overrides,
  };
}

describe('renderAts', () => {
  it('renders markdown output with candidate and job details', () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-test-'));
    try {
      const outputPath = renderAts(asset, tmpDir);
      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf-8');

      expect(content).toContain('John Doe');
      expect(content).toContain('john@example.com');
      expect(content).toContain('New York, USA');
      expect(content).toContain('TECHNICAL SKILLS');
      expect(content).toContain('## Backend');
      expect(content).toContain('Node.js, Express.js');
      expect(content).toContain('## Languages');
      expect(content).toContain('TypeScript, Python');
      expect(content).toContain('## Databases');
      expect(content).toContain('PostgreSQL, MongoDB');
      expect(content).toContain('Tech Co');
      expect(content).toContain('MIT');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders LinkedIn and GitHub in contact line', () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-test-'));
    try {
      const outputPath = renderAts(asset, tmpDir);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('linkedin.com/in/john');
      expect(content).toContain('github.com/john');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders Project section with tech stack and bullets', () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-test-'));
    try {
      const outputPath = renderAts(asset, tmpDir);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('# Projects');
      expect(content).toContain('Platform X');
      expect(content).toContain('Node.js');
      expect(content).toContain('Docker');
      expect(content).toContain('Technical Stack:');
      expect(content).toContain('Key Contributions');
      expect(content).toContain('Built the API');
      expect(content).toContain('Outcomes');
      expect(content).toContain('Reduced latency');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('renders without experience or education when arrays are empty', () => {
    const asset = makeAsset({ experience: [], education: [] });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-test-'));
    try {
      const outputPath = renderAts(asset, tmpDir);
      const content = fs.readFileSync(outputPath, 'utf-8');
      expect(content).toContain('John Doe');
      expect(content).toContain('TECHNICAL SKILLS');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('creates intermediate directories for outputPath', () => {
    const asset = makeAsset();
    const nestedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-nested-'));
    const deepDir = path.join(nestedDir, 'sub', 'dir');
    try {
      const outputPath = renderAts(asset, deepDir);
      expect(fs.existsSync(outputPath)).toBe(true);
    } finally {
      fs.rmSync(nestedDir, { recursive: true, force: true });
    }
  });

  it('throws when template file is missing', () => {
    const asset = makeAsset();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-test-'));
    try {
      expect(() =>
        renderAts(asset, tmpDir, '/nonexistent/template.hbs')
      ).toThrow();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
