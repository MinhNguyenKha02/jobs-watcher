// src/services/profile/artifacts/loaders/artifact-cache.ts

/**
 * Artifact cache layer to prevent rehydration on every retrieval call.
 * Implements singleton pattern for artifact bundle hydration.
 */

import { ArtifactLoader } from './artifact.loader.js';
import { ArtifactHydrator } from './artifact-hydrator.js';

import type { HydratedArtifactBundle } from '../types/artifact.types.js';

/**
 * Singleton artifact registry that caches the hydrated artifact bundle.
 * Ensures artifacts are loaded and hydrated only once per process.
 */
export class ArtifactRegistry {
  private static instance: ArtifactRegistry;
  private static hydratedBundle: HydratedArtifactBundle | null = null;
  private static isLoading = false;
  private static loadingPromise: Promise<HydratedArtifactBundle> | null = null;

  private constructor() {}

  /**
   * Get singleton instance of the artifact registry
   */
  public static getInstance(): ArtifactRegistry {
    if (!ArtifactRegistry.instance) {
      ArtifactRegistry.instance = new ArtifactRegistry();
    }
    return ArtifactRegistry.instance;
  }

  /**
   * Get the hydrated artifact bundle, loading it if necessary.
   * Uses double-checked locking for thread-safe initialization.
   */
  public async getArtifacts(): Promise<HydratedArtifactBundle> {
    // Return cached bundle if available
    if (ArtifactRegistry.hydratedBundle) {
      return ArtifactRegistry.hydratedBundle;
    }

    // If already loading, return the existing promise
    if (ArtifactRegistry.isLoading && ArtifactRegistry.loadingPromise) {
      return ArtifactRegistry.loadingPromise;
    }

    // Otherwise, start loading
    ArtifactRegistry.isLoading = true;
    ArtifactRegistry.loadingPromise = this.loadAndHydrateArtifacts();

    try {
      const bundle = await ArtifactRegistry.loadingPromise;
      ArtifactRegistry.hydratedBundle = bundle;
      ArtifactRegistry.isLoading = false;
      ArtifactRegistry.loadingPromise = null;
      return bundle;
    } catch (error) {
      ArtifactRegistry.isLoading = false;
      ArtifactRegistry.loadingPromise = null;
      throw error;
    }
  }

  /**
   * Load and hydrate artifacts from storage.
   * Separated for testability and clarity.
   */
  private async loadAndHydrateArtifacts(): Promise<HydratedArtifactBundle> {
    const loader = new ArtifactLoader();
    const hydrator = new ArtifactHydrator();

    const artifacts = await loader.load();
    return hydrator.hydrate(artifacts);
  }

  /**
   * Clear the cached artifacts (mainly for testing).
   * Forces reload on next getArtifacts() call.
   */
  public static clearCache(): void {
    ArtifactRegistry.hydratedBundle = null;
    ArtifactRegistry.isLoading = false;
    ArtifactRegistry.loadingPromise = null;
  }

  /**
   * Check if artifacts are currently cached.
   */
  public static hasCachedArtifacts(): boolean {
    return !!ArtifactRegistry.hydratedBundle;
  }
}