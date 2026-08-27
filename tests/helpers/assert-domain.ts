/**
 * Domain assert helpers — BVA/DT table reuse for unit(domain:profile) — src unchanged.
 * GWT still scenario GIVEN boundary WHEN rank/validate THEN decision+reason · domain profile
 */
import { expect } from 'vitest';

import type { HydratedArtifactBundle } from '../../src/domain/profile/artifacts/types/artifact.types.js';
import { EvidenceAttachmentValidator } from '../../src/domain/profile/retrieval/validation/evidence-attachment.validator.js';
import type { MatchSignal } from '../../src/domain/profile/types/retrieval.types.js';

export function assertRankBoundary(
  ranker: { rank: (s: MatchSignal, d: Map<string, MatchSignal>, e: Map<string, MatchSignal>, ev: Map<string, unknown>) => { finalScore: number; resolutionStrength: string } },
  signal: MatchSignal,
  direct: Map<string, MatchSignal>,
  expanded: Map<string, MatchSignal>,
  evidences: Map<string, unknown>,
  expectedStrength: 'strong' | 'partial' | 'weak' | 'missing'
): void {
  const result = ranker.rank(signal, direct, expanded, evidences);
  expect(['strong', 'partial', 'weak', 'missing']).toContain(result.resolutionStrength);
  expect(result.resolutionStrength).toBe(expectedStrength);
}

export function assertAttachmentValid(
  signal: MatchSignal,
  artifacts: HydratedArtifactBundle,
  jobId: string,
  expectedValid: boolean
): void {
  const validator = new EvidenceAttachmentValidator();
  const result = validator.validate(signal, artifacts, jobId);
  expect(result.valid).toBe(expectedValid);
}

export function assertCorpusHitRate(hitCount: number, total: number, opts: { min?: number } = {}): void {
  const min = opts.min ?? total;
  expect(hitCount).toBeGreaterThanOrEqual(min);
  expect(hitCount).toBeLessThanOrEqual(total);
}
