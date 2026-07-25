import { describe, it, expect } from 'vitest';
import { EvidenceProducer } from '../../../../src/domain/profile/artifacts/producers/evidence.producer.js' ;
import type { ProfileSource, ProjectSource, ExperienceSource } from '../../../../src/domain/profile/source/source.types.js' ;

describe('EvidenceProducer', () => {
  const producer = new EvidenceProducer();

  const makeProject = (overrides: Partial<ProjectSource> = {}): ProjectSource => ({
    name: 'Test Project',
    position: 'Developer',
    startDate: '2024-01',
    endDate: '2024-06',
    type: 'personal',
    anchors: {},
    key_contributions: ['Built feature X'],
    outcomes: ['Shipped on time'],
    ...overrides,
  });

  const makeExperience = (overrides: Partial<ExperienceSource> = {}): ExperienceSource => ({
    company: 'Test Corp',
    position: 'Engineer',
    startDate: '2023-01',
    endDate: '2024-01',
    anchors: {},
    responsibilities: ['Developed microservices'],
    outcomes: ['Improved perf by 20%'],
    ...overrides,
  });

  it('produces evidence for projects', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject({ name: 'Project A' }), makeProject({ name: 'Project B' })],
    };

    const evidences = producer.produce(profile);
    expect(evidences.size).toBe(2);
    expect(evidences.has('ev.project.0')).toBe(true);
    expect(evidences.has('ev.project.1')).toBe(true);
  });

  it('produces evidence for experience', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      experiences: [makeExperience({ company: 'Company A' }), makeExperience({ company: 'Company B' })],
    };

    const evidences = producer.produce(profile);
    expect(evidences.size).toBe(2);
    expect(evidences.has('ev.exp.0')).toBe(true);
    expect(evidences.has('ev.exp.1')).toBe(true);
  });

  it('produces mixed project and experience evidence', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject()],
      experiences: [makeExperience()],
    };

    const evidences = producer.produce(profile);
    expect(evidences.size).toBe(2);
    expect(evidences.has('ev.project.0')).toBe(true);
    expect(evidences.has('ev.exp.1')).toBe(true);
  });

  it('builds evidence nodes with correct structure', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject({
        name: 'My App',
        anchors: { tech: { language: ['TypeScript'] } },
        key_contributions: ['Built API', 'Wrote tests'],
        outcomes: ['Users loved it'],
      })],
    };

    const evidences = producer.produce(profile);
    const node = evidences.get('ev.project.0')!;
    expect(node.id).toBe('ev.project.0');
    expect(node.type).toBe('project');
    expect(node.title).toBe('My App');
    expect(node.anchorIds).toContain('tech.language.TypeScript');
    expect(node.bullets).toHaveLength(3);
    expect(node.bullets[0].kind).toBe('responsibility');
    expect(node.bullets[0].text).toBe('Built API');
    expect(node.bullets[2].kind).toBe('outcome');
    expect(node.bullets[2].text).toBe('Users loved it');
  });

  it('assigns bullet weights correctly', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject({
        key_contributions: ['Task'],
        outcomes: ['Result'],
      })],
    };

    const evidences = producer.produce(profile);
    const node = evidences.get('ev.project.0')!;
    expect(node.bullets[0].weight).toBe(0.8);
    expect(node.bullets[1].weight).toBe(1);
  });

  it('extracts anchor ids from anchors', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject({
        anchors: { tech: { language: ['TypeScript'], framework: ['React'] } },
      })],
    };

    const evidences = producer.produce(profile);
    const node = evidences.get('ev.project.0')!;
    expect(node.anchorIds).toContain('tech.language.TypeScript');
    expect(node.anchorIds).toContain('tech.framework.React');
  });

  it('handles empty profile gracefully', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
    };

    const evidences = producer.produce(profile);
    expect(evidences.size).toBe(0);
  });

  it('handles missing anchors', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject()],
    };

    const evidences = producer.produce(profile);
    const node = evidences.get('ev.project.0')!;
    expect(node.anchorIds).toEqual([]);
  });

  it('sets endDate to Present when not provided', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      projects: [makeProject({ endDate: undefined })],
      experiences: [makeExperience({ endDate: undefined })],
    };

    const evidences = producer.produce(profile);
    expect(evidences.get('ev.project.0')!.endDate).toBe('Present');
    expect(evidences.get('ev.exp.1')!.endDate).toBe('Present');
  });
});
