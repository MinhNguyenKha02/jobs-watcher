import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AssetBuilder } from '../../../src/infrastructure/outbound/asset-builder/asset-builder.js' ;
import type { Profile, Job } from '../../../src/domain/types/job.js' ;
import type { ResolveOutput } from '../../../src/infrastructure/outbound/asset-builder/adapter.js' ;

const builder = new AssetBuilder();
const createdDirs: string[] = [];

afterAll(() => {
  for (const dir of createdDirs) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeProfile(): Profile {
  return {
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1 555 123 4567',
    location: 'San Francisco, CA',
    title: 'Software Engineer',
    summary: 'Experienced engineer',
    skills: ['Node.js'],
    experience: [],
    education: [],
    links: {},
  };
}

function makeJob(): Job {
  return { _id: 'ut-builder-001', company: 'TestCorp', role: 'Backend Dev', description: 'Build stuff' };
}

function makeResolveOutput(): ResolveOutput {
  return {
    skills: { primary: [{ label: 'Backend', skills: ['Node.js'] }] },
    experience: [],
    projects: [],
    traces: [],
  };
}

describe('AssetBuilder', () => {
  it('build() returns BuildResult with atsPath and coverLetterPath', async () => {
    const result = await builder.build(makeProfile(), makeResolveOutput(), makeJob());
    expect(result.atsPath).toBeDefined();
    expect(result.coverLetterPath).toBeDefined();
    expect(fs.existsSync(result.atsPath!)).toBe(true);
    expect(fs.existsSync(result.coverLetterPath!)).toBe(true);

    const outputDir = path.dirname(result.atsPath!);
    createdDirs.push(outputDir);
  });

  it('buildFromAsset() renders both ATS and cover letter files', async () => {
    const result = await builder.buildFromAsset({
      jobId: 'ut-buildfrom-002',
      jobTitle: 'Backend Dev',
      company: 'TestCorp',
      sections: [],
      matchedSkills: ['Node.js'],
      skillGroups: [{ label: 'Backend', skills: ['Node.js'] }],
      skillGaps: [],
      relevanceScore: 0,
      evidenceMappings: [],
      draftedAt: '2025-01-01T00:00:00.000Z',
      profileHash: '',
      firstName: 'Jane',
      lastName: 'Smith',
      email: 'jane@example.com',
      phone: '+1 555 123 4567',
      location: 'San Francisco, CA',
      experience: [],
      education: [],
      projects: [],
    });

    expect(result.atsPath).toContain('ats-resume.md');
    expect(result.coverLetterPath).toContain('cover-letter.md');
    expect(fs.existsSync(result.atsPath!)).toBe(true);
    expect(fs.existsSync(result.coverLetterPath!)).toBe(true);

    const outputDir = path.dirname(result.atsPath!);
    createdDirs.push(outputDir);
  });

  it('rendered ATS content contains candidate name and skill groups', async () => {
    const result = await builder.build(makeProfile(), makeResolveOutput(), makeJob());
    const content = fs.readFileSync(result.atsPath!, 'utf-8');
    expect(content).toContain('Jane Smith');
    expect(content).toContain('## Backend');
    expect(content).toContain('Node.js');

    const outputDir = path.dirname(result.atsPath!);
    if (!createdDirs.includes(outputDir)) createdDirs.push(outputDir);
  });
});
