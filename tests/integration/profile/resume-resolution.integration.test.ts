import { describe, it, expect } from 'vitest';
import { ProfileRetrievalEngine } from '../../../src/domain/profile/retrieval/profile-retrieval-engine.js' ;
import { ResumeResolver } from '../../../src/domain/profile/resume/resolve/resume-resolver.js' ;
import { EvidenceAttachmentValidator } from '../../../src/domain/profile/retrieval/validation/evidence-attachment.validator.js' ;
import { retrievalPolicy } from '../../../src/domain/profile/retrieval/policies/retrieval.policy.js' ;
import { buildHydratedArtifactBundle } from '../../helpers/profile/integration-fixtures.js';
import { RetrievalLogger } from '../../../src/domain/profile/retrieval/logging/retrieval-logger.js' ;
import { retrievalPolicy as originalPolicy } from '../../../src/domain/profile/retrieval/policies/retrieval.policy.js' ;

describe('Resume Resolution Integration', () => {
  function buildFullBundle() {
    return buildHydratedArtifactBundle({
      anchors: {
        skillA: { id: 'cap.skill-a' as any, kind: 'cap' as any, category: 'tech', key: 'skill-a' },
        skillB: { id: 'cap.skill-b' as any, kind: 'cap' as any, category: 'tech', key: 'skill-b' },
      },
      surfaces: [
        { anchorId: 'cap.skill-a' as any, pattern: 'skill a', source: 'canonical', weight: 1.0 },
        { anchorId: 'cap.skill-b' as any, pattern: 'skill b', source: 'canonical', weight: 1.0 },
      ],
      adjacency: [{ from: 'cap.skill-a' as any, to: 'cap.skill-b' as any, weight: 0.5 }],
      evidenceList: [
        { id: 'ev.exp-1' as any, type: 'experience', title: 'Senior Dev', summary: 'Built things', bullets: [{ text: 'Did coding', kind: 'responsibility' }], anchorIds: ['cap.skill-a' as any] },
        { id: 'ev.exp-2' as any, type: 'experience', title: 'Junior Dev', bullets: [{ text: 'Learned coding', kind: 'responsibility' }], anchorIds: ['cap.skill-b' as any] },
        { id: 'ev.proj-1' as any, type: 'project', title: 'Project X', bullets: [{ text: 'Built X', kind: 'outcome' }], anchorIds: ['cap.skill-a' as any] },
      ],
      anchorToEvidence: [
        ['cap.skill-a' as any, ['ev.exp-1' as any, 'ev.proj-1' as any]],
        ['cap.skill-b' as any, ['ev.exp-2' as any]],
      ],
    });
  }

  describe('INT-007: accepted signal produces skills output', () => {
    it('should emit a skills section when signals pass acceptance and validation', () => {
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      // Populate evidenceIds on signals matching the bundle's anchorToEvidence
      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) {
          signal.evidenceIds = new Set(evIds);
        }
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      expect(result.skills).toBeDefined();
    });
  });

  describe('INT-008: ranked experiences sorted descending', () => {
    it('should return experience records sorted by score descending', () => {
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) signal.evidenceIds = new Set(evIds);
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      if (result.experiences.length > 1) {
        for (let i = 0; i < result.experiences.length - 1; i++) {
          expect(result.experiences[i].score).toBeGreaterThanOrEqual(result.experiences[i + 1].score);
        }
      }
    });
  });

  describe('INT-009: ranked projects sorted descending', () => {
    it('should return project records sorted by score descending', () => {
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) signal.evidenceIds = new Set(evIds);
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      if (result.projects.length > 1) {
        for (let i = 0; i < result.projects.length - 1; i++) {
          expect(result.projects[i].score).toBeGreaterThanOrEqual(result.projects[i + 1].score);
        }
      }
    });
  });

  describe('INT-010: maxExperience enforced', () => {
    it('should not exceed maxExperience limit in output', () => {
      const maxExp = retrievalPolicy.resolver.maxExperience;
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) signal.evidenceIds = new Set(evIds);
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      expect(result.experiences.length).toBeLessThanOrEqual(maxExp);
    });
  });

  describe('INT-011: maxProjects enforced', () => {
    it('should not exceed maxProjects limit in output', () => {
      const maxProj = retrievalPolicy.resolver.maxProjects;
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) signal.evidenceIds = new Set(evIds);
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      expect(result.projects.length).toBeLessThanOrEqual(maxProj);
    });
  });

  describe('INT-012: trace generated', () => {
    it('should produce trace entries with anchor ID and score', () => {
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) signal.evidenceIds = new Set(evIds);
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      for (const trace of result.traces) {
        expect(trace.anchorId).toBeDefined();
        expect(trace.score).toBeGreaterThanOrEqual(0);
        expect(trace.trace).toBeDefined();
      }
    });
  });

  describe('INT-013: resolution strength propagated to trace', () => {
    it('should attach resolution strength to each trace entry', () => {
      const bundle = buildFullBundle();
      const engine = new ProfileRetrievalEngine(bundle);
      const retrieval = engine.retrieve('skill a and skill b');

      for (const signal of retrieval.expanded.values()) {
        const evIds = bundle.anchorToEvidence.get(signal.anchorId);
        if (evIds) signal.evidenceIds = new Set(evIds);
      }

      const resolver = new ResumeResolver();
      const result = resolver.resolve(retrieval, bundle, 'test-job');

      for (const trace of result.traces) {
        for (const entry of trace.trace) {
          expect(entry.resolutionStrength).toBeDefined();
          expect(['strong', 'partial', 'weak', 'missing']).toContain(entry.resolutionStrength);
        }
      }
    });
  });
});