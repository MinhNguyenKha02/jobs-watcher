import { describe, it, expect } from 'vitest';
import { toAsset } from '../../../src/infrastructure/outbound/asset-builder/adapter.js' ;
import type { ResolveOutput } from '../../../src/infrastructure/outbound/asset-builder/adapter.js' ;
import type { Profile, Job } from '../../../src/domain/types/job.js' ;
import type { EvidenceId, AnchorId } from '../../../src/domain/profile/types/retrieval.types.js' ;

function makeProfile(overrides?: Partial<Profile>): Profile {
  return {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1 234 567 890',
    location: 'New York, USA',
    title: 'Software Engineer',
    summary: '',
    skills: [],
    experience: [],
    education: [],
    links: {},
    ...overrides,
  };
}

function makeJob(overrides?: Partial<Job>): Job {
  return {
    _id: 'job-001',
    company: 'Acme Corp',
    role: 'Backend Developer',
    description: 'Build APIs',
    ...overrides,
  };
}

function makeResolveOutput(overrides?: Partial<ResolveOutput>): ResolveOutput {
  return {
    skills: {
      primary: [
        { label: 'Backend', skills: ['Node.js', 'PostgreSQL'] },
        { label: 'Frontend', skills: ['React'] },
      ],
      secondary: [
        { label: 'Soft', skills: ['Communication'] },
      ],
    },
    experience: [
      {
        score: 0.9,
        evidence: {
          id: 'ev.exp.0' as EvidenceId,
          type: 'experience',
          title: 'Senior Developer',
          organization: 'Tech Co',
          startDate: '2020-01',
          endDate: '2023-12',
          bullets: [
            { text: 'Built microservices', kind: 'responsibility' },
          ],
          summary: '',
          anchorIds: [] as AnchorId[],
        },
      },
    ],
    projects: [
      {
        score: 0.8,
        evidence: {
          id: 'ev.project.0' as EvidenceId,
          type: 'project',
          title: 'Platform X',
          summary: 'A cloud platform',
          bullets: [],
          anchorIds: [] as AnchorId[],
        },
      },
    ],
    traces: [
      { anchorId: 'tech.backend.nodejs' as AnchorId, score: 0.9, trace: [] },
    ],
    ...overrides,
  };
}

describe('toAsset', () => {
  it('produces a valid ApplicationAsset with identity fields', () => {
    const profile = makeProfile();
    const job = makeJob();
    const resolved = makeResolveOutput();
    const asset = toAsset(resolved, profile, job);

    expect(asset.firstName).toBe('John');
    expect(asset.lastName).toBe('Doe');
    expect(asset.email).toBe('john@example.com');
    expect(asset.phone).toBe('+1 234 567 890');
    expect(asset.location).toBe('New York, USA');
    expect(asset.company).toBe('Acme Corp');
    expect(asset.jobTitle).toBe('Backend Developer');
    expect(asset.jobId).toBe('job-001');
  });

  it('preserves skillGroups from resolved primary skills', () => {
    const resolved = makeResolveOutput();
    const asset = toAsset(resolved, makeProfile(), makeJob());
    expect(asset.skillGroups).toHaveLength(2);
    expect(asset.skillGroups[0]).toEqual({ label: 'Backend', skills: ['Node.js', 'PostgreSQL'] });
    expect(asset.skillGroups[1]).toEqual({ label: 'Frontend', skills: ['React'] });
  });

  it('flattens and deduplicates matchedSkills from primary and secondary groups', () => {
    const resolved = makeResolveOutput();
    const asset = toAsset(resolved, makeProfile(), makeJob());

    expect(asset.matchedSkills).toContain('Node.js');
    expect(asset.matchedSkills).toContain('PostgreSQL');
    expect(asset.matchedSkills).toContain('React');
    expect(asset.matchedSkills).toContain('Communication');
    expect(new Set(asset.matchedSkills).size).toBe(asset.matchedSkills.length);
  });

  it('returns empty matchedSkills when no skill groups exist', () => {
    const resolved = makeResolveOutput({
      skills: { primary: [], secondary: [] },
    });
    const asset = toAsset(resolved, makeProfile(), makeJob());
    expect(asset.matchedSkills).toEqual([]);
    expect(asset.skillGroups).toEqual([]);
  });

  it('handles missing secondary skills', () => {
    const resolved = makeResolveOutput({
      skills: { primary: [{ label: 'Backend', skills: ['Node.js'] }] },
    });
    const asset = toAsset(resolved, makeProfile(), makeJob());
    expect(asset.matchedSkills).toEqual(['Node.js']);
    expect(asset.skillGroups).toHaveLength(1);
  });

  it('maps experience evidence fields correctly', () => {
    const resolved = makeResolveOutput();
    const asset = toAsset(resolved, makeProfile(), makeJob());

    expect(asset.experience!).toHaveLength(1);
    expect(asset.experience![0].title).toBe('Senior Developer');
    expect(asset.experience![0].company).toBe('Tech Co');
    expect(asset.experience![0].startDate).toBe('2020-01');
    expect(asset.experience![0].endDate).toBe('2023-12');
    expect(asset.experience![0].responsibilities).toEqual(['Built microservices']);
  });

  it('parses single-word name correctly', () => {
    const profile = makeProfile({ name: 'Minh' });
    const asset = toAsset(makeResolveOutput(), profile, makeJob());
    expect(asset.firstName).toBe('Minh');
    expect(asset.lastName).toBe('');
  });

  it('defaults experience fields when evidence is missing', () => {
    const resolved = makeResolveOutput({
      experience: [{ score: 0.5, evidence: undefined }],
    });
    const asset = toAsset(resolved, makeProfile(), makeJob());
    expect(asset.experience![0].title).toBe('');
    expect(asset.experience![0].company).toBe('');
    expect(asset.experience![0].responsibilities).toEqual([]);
  });

  it('defaults incomplete education fields', () => {
    const profile = makeProfile({
      education: [
        { institution: 'MIT', degree: '', startDate: '', endDate: '' },
      ],
    });
    const asset = toAsset(makeResolveOutput(), profile, makeJob());
    expect(asset.education![0].school).toBe('MIT');
    expect(asset.education![0].degree).toBe('');
    expect(asset.education![0].startDate).toBe('');
  });

  it('handles missing _id in job', () => {
    const job = makeJob({ _id: undefined });
    const asset = toAsset(makeResolveOutput(), makeProfile(), job);
    expect(asset.jobId).toBe('');
  });

  it('handles missing role in job', () => {
    const job = makeJob({ role: undefined });
    const asset = toAsset(makeResolveOutput(), makeProfile(), job);
    expect(asset.jobTitle).toBe('');
  });

  it('passes linkedin and github from profile links', () => {
    const profile = makeProfile({
      links: { linkedin: 'https://linkedin.com/in/john', github: 'https://github.com/john' },
    });
    const asset = toAsset(makeResolveOutput(), profile, makeJob());
    expect(asset.linkedin).toBe('https://linkedin.com/in/john');
    expect(asset.github).toBe('https://github.com/john');
  });

  it('enriches project mapping with techStack and bullets', () => {
    const resolved = makeResolveOutput({
      projects: [{
        score: 0.8,
        evidence: {
          id: 'ev.project.0' as EvidenceId,
          type: 'project',
          title: 'Platform X',
          summary: 'A cloud platform',
          techStack: { language: ['TypeScript', 'Go'], backend_framework: ['Node.js'] },
          bullets: [
            { text: 'Built the API', kind: 'responsibility' },
            { text: 'Reduced latency', kind: 'outcome' },
          ],
          anchorIds: [] as AnchorId[],
        },
      }],
    });
    const asset = toAsset(resolved, makeProfile(), makeJob());
    expect(asset.projects![0].techStack).toEqual({ language: ['TypeScript', 'Go'], backend_framework: ['Node.js'] });
    expect(asset.projects![0].responsibilities).toEqual(['Built the API']);
    expect(asset.projects![0].outcomes).toEqual(['Reduced latency']);
  });
});
