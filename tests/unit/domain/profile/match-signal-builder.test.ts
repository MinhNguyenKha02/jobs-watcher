import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MatchSignalBuilder } from '../../../../src/domain/profile/retrieval/scoring/match-signal.builder.js';
import { MatchSource } from '../../../../src/domain/profile/types/retrieval.types.js';

describe('MatchSignalBuilder', () => {
  let builder: MatchSignalBuilder;
  let policy: any;

  beforeEach(() => {
    policy = {
      direct: {
        sourceWeights: {
          canonical: 1.0,
          adjacent: 0.8,
          vendor: 0.6,
          template: 0.4,
        },
        stageWeights: {
          lexical: 1.0,
        },
        occurrenceSaturation: 10,
      },
    };

    builder = new MatchSignalBuilder(policy);
  });

  describe('Signal-001: Single lexical hit', () => {
    it('should increment occurrence, attach lexical stage, record source, and increment score', () => {
      // Arrange
      const signal = builder.create('cap.test');
      const pattern = 'test pattern';
      const source: MatchSource = 'canonical';
      const weight = 2.0;
      const start = 0;
      const end = 10;

      // Act
      builder.appendLexicalHit({ signal, pattern, source, weight, start, end });

      // Assert
      expect(signal.occurrences).toBe(1);
      expect(signal.stages.has('lexical')).toBe(true);
      expect(signal.sources.has(source)).toBe(true);
      // Calculate expected score:
      // weighted = weight * sourceWeight * stageWeight = 2.0 * 1.0 * 1.0 = 2.0
      // saturation = Math.min(1, signal.occurrences / occurrenceSaturation) = 1/10 = 0.1
      // effective = weighted * (1 - saturation * 0.45) = 2.0 * (1 - 0.1 * 0.45) = 2.0 * 0.955 = 1.91
      expect(signal.score).toBeCloseTo(1.91);
    });
  });

  describe('Signal-002: Occurrence saturation', () => {
    it('should show diminishing returns on repeated same hits', () => {
      // Arrange
      const signal = builder.create('cap.test');
      const pattern = 'test pattern';
      const source: MatchSource = 'canonical';
      const weight = 1.0;
      const start = 0;
      const end = 5;
      const occurrenceSaturation = policy.direct.occurrenceSaturation;

      // Act: Add 10 identical hits
      const scoresAfterEachHit: number[] = [];
      for (let i = 0; i < 10; i++) {
        builder.appendLexicalHit({ signal, pattern, source, weight, start, end });
        scoresAfterEachHit.push(signal.score);
      }

      // Assert: The increments should diminish due to saturation
      const increments: number[] = [];
      for (let i = 1; i < scoresAfterEachHit.length; i++) {
        increments.push(scoresAfterEachHit[i] - scoresAfterEachHit[i - 1]);
      }

      // Each increment should be less than or equal to the previous one (diminishing returns)
      for (let i = 1; i < increments.length; i++) {
        expect(increments[i]).toBeLessThanOrEqual(increments[i - 1]);
      }

      // The first increment should be the highest
      expect(increments[0]).toBeGreaterThan(increments[increments.length - 1]);

      // After 10 occurrences, saturation should be 1.0 (since 10/10 = 1)
      // effective = weighted * (1 - 1.0 * 0.45) = weighted * 0.55
      // So the increment for the 10th hit should be about 0.55 (assuming weight=1, sourceWeight=1, stageWeight=1)
      expect(increments[increments.length - 1]).toBeCloseTo(0.55, 0.1);
    });
  });

  describe('Signal-003: Propagation append', () => {
    it('should attach propagation stage and increase score', () => {
      // Arrange
      const signal = builder.create('cap.test');
      const fromAnchorId = 'comp.test';
      const weight = 3.0;

      // Act
      builder.appendPropagation({ signal, from: fromAnchorId, weight });

      // Assert
      expect(signal.stages.has('propagation')).toBe(true);
      expect(signal.score).toBe(weight); // 3.0
      // Check that the trace was added correctly
      expect(signal.trace.length).toBe(1);
      expect(signal.trace[0]).toMatchObject({
        type: 'propagation',
        from: fromAnchorId,
        to: signal.anchorId,
        scoreDelta: weight,
        reason: `Propagated from ${fromAnchorId}`,
      });
    });
  });

  describe('Signal-004: Confidence finalization', () => {
    it('should ensure confidence is between 0 and 1', () => {
      // Arrange
      const signal = builder.create('cap.test');

      // Act: Add some hits to get a score, then finalize
      builder.appendLexicalHit({
        signal,
        pattern: 'test1',
        source: 'canonical',
        weight: 2.0,
        start: 0,
        end: 4,
      });
      builder.appendLexicalHit({
        signal,
        pattern: 'test2',
        source: 'adjacent',
        weight: 1.5,
        start: 5,
        end: 9,
      });
      builder.appendPropagation({
        signal,
        from: 'comp.test',
        weight: 1.0,
      });

      // Act: Finalize the signal
      builder.finalize(signal);

      // Assert: Confidence should be between 0 and 1
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
    });
  });
});
