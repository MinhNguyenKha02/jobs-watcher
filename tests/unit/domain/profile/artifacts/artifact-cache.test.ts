import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoader = { load: vi.fn() };
const mockHydrator = { hydrate: vi.fn() };

vi.mock('../../../../../src/domain/profile/artifacts/loaders/artifact.loader.js', () => ({
  ArtifactLoader: vi.fn(() => mockLoader),
}));

vi.mock('../../../../../src/domain/profile/artifacts/loaders/artifact-hydrator.js', () => ({
  ArtifactHydrator: vi.fn(() => mockHydrator),
}));

describe('ArtifactRegistry', () => {
  let ArtifactRegistry: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset static state
    const mod = await import('../../../../../src/domain/profile/artifacts/loaders/artifact-cache.js' );
    ArtifactRegistry = mod.ArtifactRegistry;
    ArtifactRegistry.clearCache();
  });

  it('is a singleton', () => {
    const a = ArtifactRegistry.getInstance();
    const b = ArtifactRegistry.getInstance();
    expect(a).toBe(b);
  });

  it('returns cached bundle on repeated calls', async () => {
    const fakeBundle = { anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map(), aho: { en: {}, vi: {} } };
    mockLoader.load.mockResolvedValue({ anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map() });
    mockHydrator.hydrate.mockReturnValue(fakeBundle);

    const registry = ArtifactRegistry.getInstance();
    const first = await registry.getArtifacts();
    const second = await registry.getArtifacts();

    expect(first).toBe(second);
    expect(mockLoader.load).toHaveBeenCalledTimes(1);
  });

  it('loads and hydrates artifacts on first call', async () => {
    const rawBundle = { anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map() };
    const hydratedBundle = { ...rawBundle, aho: { en: {}, vi: {} } };
    mockLoader.load.mockResolvedValue(rawBundle);
    mockHydrator.hydrate.mockReturnValue(hydratedBundle);

    const registry = ArtifactRegistry.getInstance();
    const result = await registry.getArtifacts();

    expect(mockLoader.load).toHaveBeenCalled();
    expect(mockHydrator.hydrate).toHaveBeenCalledWith(rawBundle);
    expect(result).toBe(hydratedBundle);
  });

  it('shares loading promise for concurrent calls', async () => {
    mockLoader.load.mockResolvedValue({ anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map() });
    mockHydrator.hydrate.mockReturnValue({ aho: { en: {}, vi: {} } });

    const registry = ArtifactRegistry.getInstance();
    const [a, b] = await Promise.all([registry.getArtifacts(), registry.getArtifacts()]);

    expect(mockLoader.load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('clearCache resets state for fresh load', async () => {
    mockLoader.load.mockResolvedValue({ anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map() });
    mockHydrator.hydrate.mockReturnValue({ aho: { en: {}, vi: {} } });
    mockHydrator.hydrate.mockReturnValue({ aho: { en: {}, vi: {} }, version: 1 });

    const registry = ArtifactRegistry.getInstance();
    await registry.getArtifacts();
    ArtifactRegistry.clearCache();
    await registry.getArtifacts();

    expect(mockLoader.load).toHaveBeenCalledTimes(2);
  });

  it('hasCachedArtifacts reflects cache state', async () => {
    expect(ArtifactRegistry.hasCachedArtifacts()).toBe(false);

    mockLoader.load.mockResolvedValue({ anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map() });
    mockHydrator.hydrate.mockReturnValue({ aho: { en: {}, vi: {} } });

    const registry = ArtifactRegistry.getInstance();
    expect(ArtifactRegistry.hasCachedArtifacts()).toBe(false);

    await registry.getArtifacts();
    expect(ArtifactRegistry.hasCachedArtifacts()).toBe(true);

    ArtifactRegistry.clearCache();
    expect(ArtifactRegistry.hasCachedArtifacts()).toBe(false);
  });

  it('handles loading errors and allows retry', async () => {
    mockLoader.load.mockRejectedValueOnce(new Error('File not found'));
    mockLoader.load.mockResolvedValueOnce({ anchors: new Map(), evidences: new Map(), enSurfaces: [], viSurfaces: [], adjacency: new Map(), anchorToEvidence: new Map() });
    mockHydrator.hydrate.mockReturnValue({ aho: { en: {}, vi: {} } });

    const registry = ArtifactRegistry.getInstance();
    await expect(registry.getArtifacts()).rejects.toThrow('File not found');

    const result = await registry.getArtifacts();
    expect(result).toBeDefined();
    expect(mockLoader.load).toHaveBeenCalledTimes(2);
  });
});
