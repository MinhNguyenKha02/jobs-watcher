import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResumeResolver } from '../../../src/domain/profile/resume/resolve/resume-resolver.js' ;
import { RetrievalOutput } from '../../../src/domain/profile/retrieval/contracts/retrieval.types.js' ;
import { HydratedArtifactBundle } from '../../../src/domain/profile/artifacts/types/artifact.types.js' ;
import { MatchSignal, AnchorNode } from '../../../src/domain/profile/types/retrieval.types.js' ;
import { RankedSignal } from '../../../src/domain/profile/retrieval/ranking/retrieval-ranker.js' ;
import { RetrievalEvidenceScore } from '../../../src/domain/profile/artifacts/types/artifact.types.js' ;
import { retrievalPolicy } from '../../../src/domain/profile/retrieval/policies/retrieval.policy.js' ;
import { RetrievalLogger } from '../../../src/domain/profile/retrieval/logging/retrieval-logger.js' ;
import { AtsSkillSection } from '../../../src/domain/profile/resume/compiler/ats-skill-group.compiler.js' ;
import { RetrievalAcceptanceResolver } from '../../../src/domain/profile/retrieval/resolver/retrieval-acceptance.resolver.js' ;
import { AtsSkillGroupCompiler } from '../../../src/domain/profile/resume/compiler/ats-skill-group.compiler.js' ;
import { RetrievalRanker } from '../../../src/domain/profile/retrieval/ranking/retrieval-ranker.js' ;
import { EvidenceAttachmentValidator } from '../../../src/domain/profile/retrieval/validation/evidence-attachment.validator.js' ;
import { SkillKeyNormalizer } from '../../../src/domain/profile/resume/normalization/skill-key-normalizer.js' ;

vi.mock('../../../src/services/profile/retrieval/resolver/retrieval-acceptance.resolver.js');
vi.mock('../../../src/services/profile/resume/compiler/ats-skill-group.compiler.js');
vi.mock('../../../src/services/profile/retrieval/ranking/retrieval-ranker.js', () => ({
  RetrievalRanker: vi.fn(),
  RankedSignal: {},
}));
vi.mock('../../../src/services/profile/retrieval/logging/retrieval-logger.js');
vi.mock('../../../src/services/profile/retrieval/validation/evidence-attachment.validator.js');
vi.mock('../../../src/services/profile/resume/normalization/skill-key-normalizer.js');
vi.mock('../../../src/services/profile/retrieval/policies/retrieval.policy.js');

describe('ResumeResolver', () => {
  let resolver: ResumeResolver;
  let mockAcceptance: ReturnType<typeof vi.fn>;
  let mockCompile: ReturnType<typeof vi.fn>;
  let mockRank: ReturnType<typeof vi.fn>;
  let mockValidate: ReturnType<typeof vi.fn>;
  let mockNormalize: ReturnType<typeof vi.fn>;
  let mockLogMissing: ReturnType<typeof vi.fn>;
  let mockLogAccept: ReturnType<typeof vi.fn>;
  let mockLogExposure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAcceptance = vi.fn();
    mockCompile = vi.fn();
    mockRank = vi.fn();
    mockValidate = vi.fn();
    mockNormalize = vi.fn();
    mockLogMissing = vi.fn();
    mockLogAccept = vi.fn();
    mockLogExposure = vi.fn();

    vi.mocked(RetrievalAcceptanceResolver).mockImplementation(() => ({
      accept: mockAcceptance
    } as any));

    vi.mocked(AtsSkillGroupCompiler).mockImplementation(() => ({
      compile: mockCompile
    } as any));

    vi.mocked(RetrievalRanker).mockImplementation(() => ({
      rank: mockRank
    } as any));

    vi.mocked(EvidenceAttachmentValidator).mockImplementation(() => ({
      validate: mockValidate
    } as any));

    vi.mocked(SkillKeyNormalizer.normalizeSkillName).mockImplementation(mockNormalize);

    vi.mocked(RetrievalLogger.getInstance).mockReturnValue({
      logEvidenceAttachmentMissing: mockLogMissing,
      logAcceptance: mockLogAccept,
      logAtsExposure: mockLogExposure
    } as any);

    retrievalPolicy.resolver.maxExperience = 2;
    retrievalPolicy.resolver.maxProjects = 2;

    mockCompile.mockReturnValue({ name: 'test', skills: [] } as AtsSkillSection);

    resolver = new ResumeResolver();
  });

  describe('Resume-001: Accepted skill', () => {
    it('should emit accepted skill in the skills section', () => {
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.5,
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(),
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };
      const rankedSignal: RankedSignal = { signal, finalScore: 0.5, resolutionStrength: 'strong' };
      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map([['cap.test', signal]]),
        evidences: []
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map([['cap.test', { kind: 'skill', name: 'test' } as AnchorNode]]),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue(rankedSignal);
      mockAcceptance.mockReturnValue({ accepted: true, score: 0.5, reason: 'accepted' });
      mockValidate.mockReturnValue({ valid: true });

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.skills).toEqual({ name: 'test', skills: [] });
      expect(result.experience).toEqual([]);
      expect(result.projects).toEqual([]);
      expect(result.traces.length).toBe(1);
      expect(result.traces[0].anchorId).toBe('cap.test');
      expect(result.traces[0].score).toBe(0.5);
    });
  });

  describe('Resume-002: Rejected skill', () => {
    it('should not emit rejected skill in the skills section', () => {
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.5,
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(),
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };
      const rankedSignal: RankedSignal = { signal, finalScore: 0.5, resolutionStrength: 'strong' };
      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map([['cap.test', signal]]),
        evidences: []
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map([['cap.test', { kind: 'skill', name: 'test' } as AnchorNode]]),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue(rankedSignal);
      mockAcceptance.mockReturnValue({ accepted: false, score: 0.5, reason: 'low score' });
      mockValidate.mockReturnValue({ valid: true });

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.skills).toEqual({ name: 'test', skills: [] });
      expect(result.traces.length).toBe(0);
    });
  });

  describe('Resume-003: Failed evidence validation', () => {
    it('should filter out skills that fail evidence validation', () => {
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.5,
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(),
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: []
      };
      const rankedSignal: RankedSignal = { signal, finalScore: 0.5, resolutionStrength: 'strong' };
      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map([['cap.test', signal]]),
        evidences: []
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map([['cap.test', { kind: 'skill', name: 'test' } as AnchorNode]]),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue(rankedSignal);
      mockAcceptance.mockReturnValue({ accepted: true, score: 0.5, reason: 'accepted' });
      mockValidate.mockReturnValue({ valid: false, missingEvidences: ['ev1'] });

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.skills).toEqual({ name: 'test', skills: [] });
      expect(result.traces.length).toBe(0);
      expect(mockLogMissing).toHaveBeenCalledWith('test-job', 'cap.test');
    });
  });

  describe('Resume-004: Experience ordering', () => {
    it('should return experience records in descending score order', () => {
      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map(),
        evidences: [
          { evidence: { type: 'experience', id: 'exp1' }, score: 0.5 } as RetrievalEvidenceScore,
          { evidence: { type: 'experience', id: 'exp2' }, score: 0.8 } as RetrievalEvidenceScore,
          { evidence: { type: 'experience', id: 'exp3' }, score: 0.3 } as RetrievalEvidenceScore
        ]
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map(),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue([]);
      mockAcceptance.mockReturnValue({ accepted: false, score: 0, reason: 'no signals' });
      mockValidate.mockReturnValue({ valid: true });

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.experience.length).toBe(2);
      expect(result.experience[0].evidence.id).toBe('exp2');
      expect(result.experience[1].evidence.id).toBe('exp1');
    });
  });

  describe('Resume-005: Max experience limit', () => {
    it('should return only the top N experiences based on maxExperience policy', () => {
      retrievalPolicy.resolver.maxExperience = 2;

      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map(),
        evidences: [
          { evidence: { type: 'experience', id: 'exp1' }, score: 0.5 } as RetrievalEvidenceScore,
          { evidence: { type: 'experience', id: 'exp2' }, score: 0.8 } as RetrievalEvidenceScore,
          { evidence: { type: 'experience', id: 'exp3' }, score: 0.3 } as RetrievalEvidenceScore,
          { evidence: { type: 'experience', id: 'exp4' }, score: 0.6 } as RetrievalEvidenceScore
        ]
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map(),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue([]);
      mockAcceptance.mockReturnValue({ accepted: false, score: 0, reason: 'no signals' });
      mockValidate.mockReturnValue({ valid: true });

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.experience.length).toBe(2);
      expect(result.experience[0].evidence.id).toBe('exp2');
      expect(result.experience[1].evidence.id).toBe('exp4');
    });
  });

  describe('Projects ordering and limit', () => {
    it('should return projects in descending score order and respect maxProjects limit', () => {
      retrievalPolicy.resolver.maxProjects = 2;

      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map(),
        evidences: [
          { evidence: { type: 'project', id: 'proj1' }, score: 0.5 } as RetrievalEvidenceScore,
          { evidence: { type: 'project', id: 'proj2' }, score: 0.8 } as RetrievalEvidenceScore,
          { evidence: { type: 'project', id: 'proj3' }, score: 0.3 } as RetrievalEvidenceScore
        ]
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map(),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue([]);
      mockAcceptance.mockReturnValue({ accepted: false, score: 0, reason: 'no signals' });
      mockValidate.mockReturnValue({ valid: true });

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.projects.length).toBe(2);
      expect(result.projects[0].evidence.id).toBe('proj2');
      expect(result.projects[1].evidence.id).toBe('proj1');
    });
  });

  describe('Traces contain resolution strength', () => {
    it('should update the trace of each signal with the resolution strength from ranking', () => {
      const signal: MatchSignal = {
        anchorId: 'cap.test',
        score: 0.5,
        confidence: 0.8,
        occurrences: 2,
        stages: new Set(['lexical']),
        evidenceIds: new Set(),
        matchedPatterns: ['test pattern'],
        occurrencesDetail: [],
        sources: new Set(['canonical']),
        trace: [{ type: 'lexical-hit', scoreDelta: 0.3, reason: 'test reason' }]
      };
      const rankedSignal: RankedSignal = { signal, finalScore: 0.5, resolutionStrength: 'strong' };
      const retrieval: RetrievalOutput = {
        direct: new Map(),
        expanded: new Map([['cap.test', signal]]),
        evidences: []
      };
      const artifacts: HydratedArtifactBundle = {
        anchors: new Map([['cap.test', { kind: 'skill', name: 'test' } as AnchorNode]]),
        evidences: new Map(),
        surfaces: [],
        adjacency: new Map()
      };

      mockRank.mockReturnValue(rankedSignal);
      mockAcceptance.mockReturnValue({ accepted: true, score: 0.5, reason: 'accepted' });
      mockValidate.mockReturnValue({ valid: true });
      mockCompile.mockReturnValue({ name: 'test', skills: [] } as AtsSkillSection);

      const result = resolver.resolve(retrieval, artifacts, 'test-job');

      expect(result.traces.length).toBe(1);
      expect(result.traces[0].trace[0]).toMatchObject({
        type: 'lexical-hit',
        resolutionStrength: 'strong'
      });
    });
  });
});