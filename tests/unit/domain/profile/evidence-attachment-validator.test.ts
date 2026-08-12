import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HydratedArtifactBundle } from '../../../../src/domain/profile/artifacts/types/artifact.types.js';
import { RetrievalLogger } from '../../../../src/domain/profile/retrieval/logging/retrieval-logger.js';
import { EvidenceAttachmentValidator } from '../../../../src/domain/profile/retrieval/validation/evidence-attachment.validator.js';
import { MatchSignal } from '../../../../src/domain/profile/types/retrieval.types.js';

describe('EvidenceAttachmentValidator', () => {
  let validator: EvidenceAttachmentValidator;
  let mockLogger: RetrievalLogger;
  let mockSignal: MatchSignal;
  let mockArtifacts: HydratedArtifactBundle;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up the mock logger
    mockLogger = {
      logEvidenceAttachmentMissing: vi.fn(),
    } as RetrievalLogger;
    vi.spyOn(RetrievalLogger, 'getInstance').mockReturnValue(mockLogger);

    // Set up a basic signal with one evidence ID
    mockSignal = {
      anchorId: 'cap.test',
      score: 0.5,
      confidence: 0.8,
      occurrences: 2,
      stages: new Set(['lexical']),
      evidenceIds: new Set(['ev.test']),
      matchedPatterns: [],
      occurrencesDetail: [],
      sources: new Set(['canonical']),
      trace: [],
    } as MatchSignal;

    // Set up basic artifacts
    mockArtifacts = {
      anchors: new Map<string, any>(),
      evidences: new Map<string, any>(),
      surfaces: [],
      adjacency: new Map(),
      anchorToEvidence: new Map<string, Set<string>>(),
    } as HydratedArtifactBundle;

    validator = new EvidenceAttachmentValidator();
  });

  describe('Attachment-001: Anchor missing', () => {
    it('GIVEN anchor does not exist WHEN EvidenceAttachmentValidator evaluates THEN return invalid', () => {
      // Arrange: anchorId 'cap.test' is not in the artifacts.anchors map

      // Act
      const result = validator.validate(mockSignal, mockArtifacts, 'test-job');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Anchor not found');
      // Verify logger was called
      expect(mockLogger.logEvidenceAttachmentMissing).toHaveBeenCalledWith('test-job', 'cap.test');
    });
  });

  describe('Attachment-002: No mapping exists', () => {
    it('GIVEN anchor exists but has no evidence mappings WHEN EvidenceAttachmentValidator evaluates THEN return invalid', () => {
      // Arrange
      const anchor = {
        id: 'cap.test',
        kind: 'cap' as const,
        category: 'test',
        key: 'test',
      };
      mockArtifacts.anchors.set('cap.test', anchor);
      // Note: we do NOT set any anchorToEvidence mapping for this anchor

      // Act
      const result = validator.validate(mockSignal, mockArtifacts, 'test-job');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No evidence mappings found');
      // Verify logger was called
      expect(mockLogger.logEvidenceAttachmentMissing).toHaveBeenCalledWith('test-job', 'cap.test');
    });
  });

  describe('Attachment-003: Evidence missing', () => {
    it('GIVEN anchor and mapping exist but evidence does not WHEN EvidenceAttachmentValidator evaluates THEN return invalid', () => {
      // Arrange
      const anchor = {
        id: 'cap.test',
        kind: 'cap' as const,
        category: 'test',
        key: 'test',
      };
      mockArtifacts.anchors.set('cap.test', anchor);

      // Set up the anchorToEvidence mapping: anchor -> {ev.test}
      const evidenceIdsSet = new Set(['ev.test']);
      mockArtifacts.anchorToEvidence.set(anchor.id, evidenceIdsSet);

      // Note: we do NOT add the evidence 'ev.test' to the artifacts.evidences map

      // Act
      const result = validator.validate(mockSignal, mockArtifacts, 'test-job');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No valid evidence found');
      // Verify logger was called
      expect(mockLogger.logEvidenceAttachmentMissing).toHaveBeenCalledWith('test-job', 'cap.test');
    });
  });

  describe('Attachment-004: Valid mapping', () => {
    it('GIVEN anchor, mapping, and evidence all exist WHEN EvidenceAttachmentValidator evaluates THEN return valid', () => {
      // Arrange
      const anchor = {
        id: 'cap.test',
        kind: 'cap' as const,
        category: 'test',
        key: 'test',
      };
      mockArtifacts.anchors.set('cap.test', anchor);

      // Set up the anchorToEvidence mapping: anchor -> {ev.test}
      const evidenceIdsSet = new Set(['ev.test']);
      mockArtifacts.anchorToEvidence.set(anchor.id, evidenceIdsSet);

      // Add the evidence
      const evidence = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'project',
        title: 'Test Evidence',
        summary: '',
        bullets: [],
        technologies: [],
      };
      mockArtifacts.evidences.set('ev.test', evidence);

      // Act
      const result = validator.validate(mockSignal, mockArtifacts, 'test-job');

      // Assert
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
      // Verify logger was NOT called for missing evidence
      expect(mockLogger.logEvidenceAttachmentMissing).not.toHaveBeenCalled();
    });
  });
});
