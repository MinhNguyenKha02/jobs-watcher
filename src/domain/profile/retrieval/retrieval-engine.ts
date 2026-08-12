// src/services/profile/retrieval/retrieval-engine.ts

import { ArtifactRegistry } from '../artifacts/loaders/artifact-cache.js';

import { ProfileRetrievalEngine } from './profile-retrieval-engine.js';

export async function bootstrapRetrieval() {
  const hydrated = await ArtifactRegistry.getInstance().getArtifacts();
  return new ProfileRetrievalEngine(hydrated);
}
