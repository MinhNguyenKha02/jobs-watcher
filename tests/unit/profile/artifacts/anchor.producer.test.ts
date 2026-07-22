import { describe, it, expect } from 'vitest';
import { AnchorProducer } from '../../../../src/domain/profile/artifacts/producers/anchor.producer.js' ;
import type { ProfileSource } from '../../../../src/domain/profile/source/source.types.js' ;

describe('AnchorProducer', () => {
  const producer = new AnchorProducer();

  it('produces anchors from all sections', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      cap: { language: ['Go', 'TypeScript'] },
      comp: { skill: ['DSA', 'OS'] },
      beh: { soft: ['Teamwork', 'Communication'] },
      tech: { tool: ['Docker', 'Kubernetes'] },
    };

    const anchors = producer.produce(profile);
    expect(anchors.size).toBe(8);
    expect(anchors.has('cap.language.Go')).toBe(true);
    expect(anchors.has('cap.language.TypeScript')).toBe(true);
    expect(anchors.has('comp.skill.DSA')).toBe(true);
    expect(anchors.has('beh.soft.Communication')).toBe(true);
    expect(anchors.has('tech.tool.Kubernetes')).toBe(true);
  });

  it('creates anchor nodes with correct shape', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      cap: { language: ['Go'] },
    };

    const anchors = producer.produce(profile);
    const node = anchors.get('cap.language.Go');
    expect(node).toEqual({
      id: 'cap.language.Go',
      kind: 'cap',
      category: 'language',
      key: 'Go',
    });
  });

  it('handles empty sections gracefully', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      cap: {},
      comp: {},
      beh: {},
    };

    const anchors = producer.produce(profile);
    expect(anchors.size).toBe(0);
  });

  it('handles missing sections', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
    };

    const anchors = producer.produce(profile);
    expect(anchors.size).toBe(0);
  });

  it('iterates category entries preserving order', () => {
    const profile: ProfileSource = {
      name: 'Test',
      email: 'test@test.com',
      tech: { tool: ['Docker'], platform: ['AWS'] },
    };

    const anchors = producer.produce(profile);
    expect(anchors.size).toBe(2);
    expect([...anchors.keys()]).toEqual(['tech.tool.Docker', 'tech.platform.AWS']);
  });

  it('uses empty map for completely empty profile', () => {
    const anchors = producer.produce({} as ProfileSource);
    expect(anchors.size).toBe(0);
  });
});
