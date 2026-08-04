import { describe, it, expect } from 'vitest';
import { AssetProducingAdapter } from '../../../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import type { ResolveOutput } from '../../../../src/domain/profile/types/resolve.types.js';
import type { EvidenceId, AnchorId } from '../../../../src/domain/profile/types/retrieval.types.js';
import type { ProfileSource } from '../../../../src/domain/profile/source/source.types.js';

function makeProfile(overrides?: Partial<ProfileSource>): ProfileSource {
  return {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1 234 567 890',
    location: 'New York, USA',
    title: 'Software Engineer',
    cap: {},
    comp: {},
    beh: {},
    tech: {},
    projects: [],
    experience: [],
    education: [],
    links: {},
    ...overrides,
  } as ProfileSource;
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
    experiences: [
      {
        score: 0.9,
        evidence: {
          id: 'ev.exp.0' as EvidenceId,
          type: 'experience',
          title: 'Senior Developer',
          company: 'Tech Co',
          position: 'Senior Developer',
          startDate: '2020-01',
          endDate: '2023-12',
          bullets: [
            { text: 'Built microservices', kind: 'responsibility' },
            { text: 'Reduced latency by 40%', kind: 'outcome' },
          ],
          summary: '',
          anchorIds: [] as AnchorId[],
          technologies: [],
          links: [],
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
          bullets: [
            { text: 'Built the API', kind: 'responsibility' },
            { text: 'Reduced latency', kind: 'outcome' },
          ],
          anchorIds: [] as AnchorId[],
          technologies: ['TypeScript'],
          links: { github: ['platform-x-repo:https://github.com/test/platform-x'] },
        },
      },
    ],
    traces: [
      { anchorId: 'tech.backend.nodejs' as AnchorId, score: 0.9, trace: [] as any[] },
    ],
    ...overrides,
  };
}

describe('AssetProducingAdapter', () => {
  const adapter = new AssetProducingAdapter();

  it('maps identity fields and contact to PdfAsset', () => {
    const profile = makeProfile();
    const resolved = makeResolveOutput();
    const pdf = adapter.toPdf(resolved, profile);

    expect(pdf.name).toBe('John Doe');
    expect(pdf.contact.email).toBe('john@example.com');
    expect(pdf.contact.phone).toBe('+1 234 567 890');
    expect(pdf.contact.location).toBe('New York, USA');
  });

  it('passes skillGroups from resolved primary skills', () => {
    const resolved = makeResolveOutput();
    const pdf = adapter.toPdf(resolved, makeProfile());

    expect(pdf.skillGroups.length).toBeGreaterThan(0);
    const backend = pdf.skillGroups.find(g => g.label === 'Backend');
    expect(backend).toBeDefined();
    expect(backend!.skills).toContain('Node.js');
    expect(backend!.skills).toContain('PostgreSQL');
  });

  it('maps experiences with bullet separation', () => {
    const resolved = makeResolveOutput();
    const pdf = adapter.toPdf(resolved, makeProfile());

    expect(pdf.experiences).toHaveLength(1);
    expect(pdf.experiences[0].title).toBe('Senior Developer');
    expect(pdf.experiences[0].company).toBe('Tech Co');
    expect(pdf.experiences[0].responsibilities).toEqual(['Built microservices']);
    expect(pdf.experiences[0].outcomes).toEqual(['Reduced latency by 40%']);
    expect(pdf.experiences[0].startDate).toBe('2020-01');
    expect(pdf.experiences[0].endDate).toBe('2023-12');
  });

  it('maps projects with contributions and outcomes', () => {
    const resolved = makeResolveOutput();
    const pdf = adapter.toPdf(resolved, makeProfile());

    expect(pdf.projects).toHaveLength(1);
    expect(pdf.projects[0].title).toBe('Platform X');
    expect(pdf.projects[0].description).toBe('A cloud platform');
    expect(pdf.projects[0].keyContributions).toEqual(['Built the API']);
    expect(pdf.projects[0].outcomes).toEqual(['Reduced latency']);
  });

  it('parses evidence links into key/alias/url structure', () => {
    const resolved = makeResolveOutput();
    const pdf = adapter.toPdf(resolved, makeProfile());

    expect(pdf.projects[0].evidences).toHaveLength(1);
    const ev = pdf.projects[0].evidences[0];
    expect(ev.key).toBeDefined();
    expect(ev.items[0].alias).toBe('platform-x-repo');
    expect(ev.items[0].url).toBe('https://github.com/test/platform-x');
  });

  it('includes education from profile', () => {
    const profile = makeProfile({
      education: [
        { institution: 'MIT', degree: 'BS', startDate: '2016', endDate: '2020', grade: '' },
      ],
    });
    const pdf = adapter.toPdf(makeResolveOutput(), profile);

    expect(pdf.education).toHaveLength(1);
    expect(pdf.education[0].institution).toBe('MIT');
  });

  it('handles empty experiences and projects', () => {
    const resolved = makeResolveOutput({ experiences: [], projects: [] });
    const pdf = adapter.toPdf(resolved, makeProfile());

    expect(pdf.experiences).toEqual([]);
    expect(pdf.projects).toEqual([]);
  });

  it('defaults empty fields when evidence is missing', () => {
    const resolved = makeResolveOutput({
      experiences: [{ score: 0.5, evidence: undefined } as any],
    });
    const pdf = adapter.toPdf(resolved, makeProfile());

    expect(pdf.experiences[0].title).toBe('');
    expect(pdf.experiences[0].company).toBe('');
    expect(pdf.experiences[0].responsibilities).toEqual([]);
  });

  it('handles single-word name', () => {
    const profile = makeProfile({ name: 'Minh' });
    const pdf = adapter.toPdf(makeResolveOutput(), profile);

    expect(pdf.name).toBe('Minh');
  });

  it('passes linkedin and github from profile links', () => {
    const profile = makeProfile({
      links: { linkedin: 'https://linkedin.com/in/john', github: 'https://github.com/john' },
    });
    const pdf = adapter.toPdf(makeResolveOutput(), profile);

    expect(pdf.contact.linkedin).toBe('https://linkedin.com/in/john');
    expect(pdf.contact.github).toBe('https://github.com/john');
  });

  it('remaps category groups via reSkillGroups', () => {
    const resolved = makeResolveOutput({
      skills: {
        primary: [
          { label: 'Backend', skills: ['Node.js'] },
          { label: 'Frameworks', skills: ['Express.js'] },
          { label: 'Languages', skills: ['TypeScript'] },
        ],
      },
    });
    const pdf = adapter.toPdf(resolved, makeProfile());

    const backend = pdf.skillGroups.find(g => g.label === 'Backend');
    expect(backend).toBeDefined();
    expect(backend!.skills).toContain('Node.js');
    expect(backend!.skills).toContain('Express.js');

    const languages = pdf.skillGroups.find(g => g.label === 'Languages');
    expect(languages).toBeDefined();
    expect(languages!.skills).toContain('TypeScript');
  });
});
