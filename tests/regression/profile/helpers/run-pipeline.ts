import fs from 'node:fs';
import { flattenJob } from '../../../../src/domain/services/flatten-job.js' ;
import { bootstrapRetrieval } from '../../../../src/domain/profile/retrieval/retrieval-engine.js' ;
import { ResumeResolver } from '../../../../src/domain/profile/resume/resolve/resume-resolver.js' ;
import { ArtifactRegistry } from '../../../../src/domain/profile/artifacts/loaders/artifact-cache.js' ;
import { buildArtifacts } from '../../../../src/domain/profile/artifacts/builders/artifact.builder.js' ;
import { ARTIFACT_OUTPUT_DIR } from '../../../../src/domain/profile/artifacts/constants/artifact.constants.js' ;
import type { ProfileRetrievalEngine } from '../../../../src/domain/profile/retrieval/profile-retrieval-engine.js' ;
import type { HydratedArtifactBundle } from '../../../../src/domain/profile/artifacts/types/artifact.types.js' ;
import type { RetrievalOutput } from '../../../../src/domain/profile/retrieval/contracts/retrieval.types.js' ;
import { captureDebug, type DebugSnapshot } from '../../../../src/domain/profile/retrieval/retrieval-debugger.js' ;
import type { ResolveOutput } from '../../../../src/domain/profile/types/resolve.types.js';

export interface CorpusEntry {
  _id: string;
  company: string;
  role: string;
  description?: string;
  details?: Record<string, unknown>;
  salary?: string;
  location?: string;
}

export interface PipelineComponents {
  engine: ProfileRetrievalEngine;
  artifacts: HydratedArtifactBundle;
  resolver: ResumeResolver;
}

export async function createPipeline(): Promise<PipelineComponents> {
  // Auto-generate artifacts if the output directory doesn't exist
  if (!fs.existsSync(ARTIFACT_OUTPUT_DIR)) {
    console.log('Generating artifacts (output directory not found)...');
    await buildArtifacts();
  }
  ArtifactRegistry.clearCache();
  const engine = await bootstrapRetrieval();
  const artifacts = await ArtifactRegistry.getInstance().getArtifacts();
  const resolver = new ResumeResolver();
  return { engine, artifacts, resolver };
}

export function runSingle(
  { engine, artifacts, resolver }: PipelineComponents,
  entry: CorpusEntry,
): ResolveOutput {
  const jobText = flattenJob(entry);
  const retrieval = engine.retrieve(jobText);
  const result = resolver.resolve(retrieval, artifacts, entry._id);
  return result;
}

export function runWithDebug(
  { engine, artifacts, resolver }: PipelineComponents,
  entry: CorpusEntry,
): { result: ResolveOutput; retrieval: RetrievalOutput; debug: DebugSnapshot } {
  const jobText = flattenJob(entry);
  const retrieval = engine.retrieve(jobText);
  const result = resolver.resolve(retrieval, artifacts, entry._id);
  return { result, retrieval, debug: captureDebug(retrieval, result) };
}

export function flattenSkills(result: { skills: { primary: { skills: string[] }[]; secondary?: { skills: string[] }[] } }): string[] {
  return [
    ...result.skills.primary.flatMap(g => g.skills),
    ...(result.skills.secondary?.flatMap(g => g.skills) ?? []),
  ];
}
