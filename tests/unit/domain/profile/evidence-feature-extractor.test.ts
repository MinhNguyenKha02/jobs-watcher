import { describe, it, expect } from 'vitest';
import { EvidenceFeaturesExtractor } from '../../../../src/domain/profile/retrieval/evidence/evidence-feature-extractor.js';
import { EvidenceNode } from '../../../../src/domain/profile/types/retrieval.types.js';

describe('EvidenceFeaturesExtractor', () => {
  describe('Feature-001: Operational keywords', () => {
    it('GIVEN operational keywords are present WHEN EvidenceFeaturesExtractor evaluates THEN produce operationalScore > 0', () => {
      // Arrange
      const evidence: EvidenceNode = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'project',
        title: 'Test Project',
        summary: 'I worked in production environment managing deployment and monitoring systems.',
        bullets: [
          { text: 'Deployed applications to runtime environment', kind: 'responsibility' },
          { text: 'Monitored system observability and alerting', kind: 'outcome' },
        ],
        technologies: ['Docker', 'Kubernetes'],
      };

      // Act
      const features = EvidenceFeaturesExtractor.extract(evidence);

      // Assert
      expect(features.operationalScore).toBeGreaterThan(0);
      // We should have matches for: production, runtime, deployment, monitoring, observability, alerting, workflow
      // That's 7 out of 9 keywords = 0.777...
      expect(features.operationalScore).toBeCloseTo(7 / 9, 0.01);
    });
  });

  describe('Feature-002: Architecture keywords', () => {
    it('GIVEN architecture keywords are present WHEN EvidenceFeaturesExtractor evaluates THEN produce architectureScore > 0', () => {
      // Arrange
      const evidence: EvidenceNode = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'project',
        title: 'Test Project',
        summary: 'Designed event-driven microservices with orchestration patterns.',
        bullets: [
          { text: 'Implemented distributed system architecture', kind: 'responsibility' },
          { text: 'Used hexagonal architecture principles', kind: 'responsibility' },
        ],
        technologies: ['Node.js', 'PostgreSQL'],
      };

      // Act
      const features = EvidenceFeaturesExtractor.extract(evidence);

      // Assert
      expect(features.architectureScore).toBeGreaterThan(0);
      // We should have matches for: event-driven, orchestration, distributed, hexagonal
      // That's 4 out of 5 keywords = 0.8
      expect(features.architectureScore).toBeCloseTo(4 / 5, 0.01);
    });
  });

  describe('Feature-003: Ownership keywords', () => {
    it('GIVEN ownership keywords are present WHEN EvidenceFeaturesExtractor evaluates THEN produce ownershipScore > 0', () => {
      // Arrange
      const evidence: EvidenceNode = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'experience',
        title: 'Senior Engineer',
        organization: 'Tech Corp',
        summary: 'Built and developed scalable web applications.',
        bullets: [
          { text: 'Designed API architecture from scratch', kind: 'responsibility' },
          { text: 'Led team of 5 engineers', kind: 'responsibility' },
        ],
        technologies: ['React', 'MongoDB'],
      };

      // Act
      const features = EvidenceFeaturesExtractor.extract(evidence);

      // Assert
      expect(features.ownershipScore).toBeGreaterThan(0);
      // We should have matches for: built, implemented, designed, developed, architected, led
      // That's 6 out of 6 keywords = 1.0
      expect(features.ownershipScore).toBeCloseTo(1.0, 0.01);
    });
  });

  describe('Feature-004: Quantified metrics', () => {
    it('GIVEN quantified metrics are present WHEN EvidenceFeaturesExtractor evaluates THEN produce quantifiedScore > 0', () => {
      // Arrange
      const evidence: EvidenceNode = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'project',
        title: 'Test Project',
        summary: 'Improved system performance by 40% and reduced latency by 200ms.',
        bullets: [
          { text: 'Handled 10k requests per second', kind: 'responsibility' },
          { text: 'Supported 5m active users', kind: 'outcome' },
        ],
        technologies: ['AWS', 'PostgreSQL'],
      };

      // Act
      const features = EvidenceFeaturesExtractor.extract(evidence);

      // Assert
      expect(features.quantifiedScore).toBeGreaterThan(0);
      // We should have matches for: 40%, 200ms, 10k, 5m
      // That's 4 matches
      // Score = min(4/5, 1) = 0.8
      expect(features.quantifiedScore).toBeCloseTo(0.8, 0.01);
    });
  });

  describe('Feature-005: Score cap', () => {
    it('GIVEN EvidenceFeaturesExtractor WHEN EvidenceFeaturesExtractor evaluates THEN ensure quantifiedScore <= 1 even with many matches', () => {
      // Arrange
      const evidence: EvidenceNode = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'project',
        title: 'Test Project',
        summary: 'Numbers: 10 20 30 40 50 60 70 80 90 100',
        bullets: [{ text: 'More numbers: 1 2 3 4 5', kind: 'responsibility' }],
        technologies: ['Java'],
      };

      // Act
      const features = EvidenceFeaturesExtractor.extract(evidence);

      // Assert
      // We have many number matches (15 total from summary + 5 from bullets = 20)
      // Score = min(20/5, 1) = min(4, 1) = 1
      expect(features.quantifiedScore).toBeLessThanOrEqual(1);
      expect(features.quantifiedScore).toBe(1.0);
    });
  });

  // Additional test: no matches should give zero scores
  describe('Edge case: no matches', () => {
    it('GIVEN no keywords or metrics are present WHEN EvidenceFeaturesExtractor evaluates THEN produce zero scores', () => {
      // Arrange
      // Using text that avoids accidental substring matches for ownership keywords (e.g., no 'knowledge' which contains 'led')
      const evidence: EvidenceNode = {
        id: 'ev.test',
        anchorIds: ['cap.test'],
        type: 'project',
        title: 'Test Project',
        summary: 'Worked on various tasks as part of the group.',
        bullets: [
          { text: 'Attended meetings and updated documentation', kind: 'responsibility' },
          { text: 'Learned new technologies and shared information', kind: 'outcome' },
        ],
        technologies: ['HTML', 'CSS'],
      };

      // Act
      const features = EvidenceFeaturesExtractor.extract(evidence);

      // Assert
      expect(features.operationalScore).toBe(0);
      expect(features.architectureScore).toBe(0);
      expect(features.ownershipScore).toBe(0);
      expect(features.quantifiedScore).toBe(0);
    });
  });
});
