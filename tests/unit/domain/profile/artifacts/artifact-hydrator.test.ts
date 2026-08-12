import { describe, it, expect, vi } from 'vitest';

import { ArtifactHydrator } from '../../../../../src/domain/profile/artifacts/loaders/artifact-hydrator.js';
import type { ArtifactBundle } from '../../../../../src/domain/profile/artifacts/types/artifact.types.js';

vi.mock('../../../../../src/services/profile/artifacts/producers/aho.producer.js', () => ({
  AhoProducer: vi.fn().mockImplementation(() => ({
    produce: vi.fn((surfaces: any[]) => ({
      search: vi.fn(() => []),
      insert: vi.fn(),
      buildFallbackLinks: vi.fn(),
      surfaceCount: surfaces.length,
    })),
  })),
}));

describe('ArtifactHydrator', () => {
  const hydrator = new ArtifactHydrator();

  const makeBundle = (overrides: Partial<ArtifactBundle> = {}): ArtifactBundle => ({
    anchors: new Map(),
    evidences: new Map(),
    enSurfaces: [
      {
        pattern: 'test',
        anchorId: 'cap.language.Go' as any,
        language: 'en',
        source: 'canonical',
        weight: 1,
      },
    ],
    viSurfaces: [
      {
        pattern: 'kiem tra',
        anchorId: 'cap.language.Go' as any,
        language: 'vi',
        source: 'canonical',
        weight: 1,
      },
    ],
    adjacency: new Map(),
    anchorToEvidence: new Map(),
    ...overrides,
  });

  it('GIVEN ArtifactHydrator WHEN ArtifactHydrator evaluates THEN adds aho property to the bundle', () => {
    const bundle = makeBundle();
    const hydrated = hydrator.hydrate(bundle);

    expect(hydrated).toHaveProperty('aho');
    expect(hydrated.aho).toHaveProperty('en');
    expect(hydrated.aho).toHaveProperty('vi');
  });

  it('GIVEN ArtifactHydrator WHEN ArtifactHydrator evaluates THEN preserves all original bundle properties', () => {
    const bundle = makeBundle();
    const hydrated = hydrator.hydrate(bundle);

    expect(hydrated.anchors).toBe(bundle.anchors);
    expect(hydrated.evidences).toBe(bundle.evidences);
    expect(hydrated.enSurfaces).toBe(bundle.enSurfaces);
    expect(hydrated.viSurfaces).toBe(bundle.viSurfaces);
    expect(hydrated.adjacency).toBe(bundle.adjacency);
    expect(hydrated.anchorToEvidence).toBe(bundle.anchorToEvidence);
  });

  it('GIVEN ArtifactHydrator WHEN ArtifactHydrator evaluates THEN builds aho automaton for each language', () => {
    const bundle = makeBundle({
      enSurfaces: [
        {
          pattern: 'Go developer',
          anchorId: 'cap.language.Go' as any,
          language: 'en',
          source: 'canonical',
          weight: 1,
        },
        {
          pattern: 'TypeScript',
          anchorId: 'cap.language.TypeScript' as any,
          language: 'en',
          source: 'canonical',
          weight: 1,
        },
      ],
      viSurfaces: [
        {
          pattern: 'lap trinh vien Go',
          anchorId: 'cap.language.Go' as any,
          language: 'vi',
          source: 'canonical',
          weight: 1,
        },
      ],
    });

    const hydrated = hydrator.hydrate(bundle);
    expect(hydrated.aho.en).toBeDefined();
    expect(hydrated.aho.vi).toBeDefined();
  });

  it('GIVEN ArtifactHydrator WHEN ArtifactHydrator evaluates THEN returns a valid HydratedArtifactBundle', () => {
    const bundle = makeBundle();
    const hydrated = hydrator.hydrate(bundle);

    expect(hydrated.anchors).toBeInstanceOf(Map);
    expect(hydrated.evidences).toBeInstanceOf(Map);
    expect(Array.isArray(hydrated.enSurfaces)).toBe(true);
    expect(Array.isArray(hydrated.viSurfaces)).toBe(true);
    expect(hydrated.adjacency).toBeInstanceOf(Map);
    expect(hydrated.anchorToEvidence).toBeInstanceOf(Map);
  });
});
