import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RetrievalPolicy } from '../../../../src/domain/profile/retrieval/policies/retrieval.policy.js';
import { PropagationEngine } from '../../../../src/domain/profile/retrieval/propagation/propagation-engine.js';
import { MatchSignalBuilder } from '../../../../src/domain/profile/retrieval/scoring/match-signal.builder.js';
import {
  AnchorId,
  MatchSignal,
  AdjacencyEdge,
} from '../../../../src/domain/profile/types/retrieval.types.js';

describe('PropagationEngine', () => {
  let engine: PropagationEngine;
  let adjacency: Map<AnchorId, AdjacencyEdge[]>;

  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();

    // Set up the mock policy with default values that can be overridden in tests
    const mockPolicy = {
      propagation: {
        maxDepth: 2,
        decayFactor: 0.72,
        blockedKinds: [], // e.g., ['beh']
        minEdgeWeight: 0.1,
        maxExpandedAnchors: 1000,
      },
      direct: {
        minScore: 0.1,
      },
    };

    // Create the engine with our adjacency map
    engine = new PropagationEngine(mockPolicy as RetrievalPolicy, new Map());
  });

  // Helper to create a direct signal
  const createDirectSignal = (anchorId: AnchorId, score: number): MatchSignal => {
    return {
      anchorId,
      score,
      confidence: 0.8,
      occurrences: 1,
      stages: new Set(['lexical']),
      evidenceIds: new Set(),
      matchedPatterns: [],
      occurrencesDetail: [],
      sources: new Set(['canonical']),
      trace: [],
    } as MatchSignal;
  };

  describe('Prop-001: Single edge', () => {
    it('GIVEN A -> B exists WHEN PropagationEngine evaluates THEN resolve B', () => {
      // Arrange
      const aId: AnchorId = 'cap.A';
      const bId: AnchorId = 'cap.B';
      // Create adjacency map: aId -> [ { from: aId, to: bId, weight: 0.5 } ]
      const adjacencyMap = new Map<AnchorId, AdjacencyEdge[]>();
      adjacencyMap.set(aId, [{ from: aId, to: bId, weight: 0.5 }]);

      // Create the engine with this adjacency map
      const engine = new PropagationEngine(
        {
          propagation: {
            maxDepth: 2,
            decayFactor: 0.72,
            blockedKinds: [],
            minEdgeWeight: 0.1,
            maxExpandedAnchors: 1000,
          },
          direct: {
            minScore: 0.1,
          },
        } as RetrievalPolicy,
        adjacencyMap
      );

      const directSignals = new Map<AnchorId, MatchSignal>();
      directSignals.set(aId, createDirectSignal(aId, 1.0));

      // Act
      const expanded = engine.propagate(directSignals);

      // Assert
      expect(expanded.has(bId)).toBe(true);
      const bSignal = expanded.get(bId);
      expect(bSignal).toBeDefined();
      // The propagated score should be: 1.0 (A's score) * 0.5 (edge weight) * 0.72 (decay) = 0.36
      expect(bSignal?.score).toBeCloseTo(0.36);
    });
  });

  describe('Prop-002: Decay formula', () => {
    it('GIVEN PropagationEngine input "{\n          propagation: {\n            maxDepth: 2" WHEN PropagationEngine evaluates THEN apply the decay formula correctly', () => {
      // Arrange
      const aId: AnchorId = 'cap.A';
      const bId: AnchorId = 'cap.B';
      const adjacencyMap = new Map<AnchorId, AdjacencyEdge[]>();
      adjacencyMap.set(aId, [{ from: aId, to: bId, weight: 0.35 }]);

      const engine = new PropagationEngine(
        {
          propagation: {
            maxDepth: 2,
            decayFactor: 0.72,
            blockedKinds: [],
            minEdgeWeight: 0.1,
            maxExpandedAnchors: 1000,
          },
          direct: {
            minScore: 0.1,
          },
        } as RetrievalPolicy,
        adjacencyMap
      );

      const directSignals = new Map<AnchorId, MatchSignal>();
      directSignals.set(aId, createDirectSignal(aId, 1.0));

      // Act
      const expanded = engine.propagate(directSignals);

      // Assert
      expect(expanded.has(bId)).toBe(true);
      const bSignal = expanded.get(bId);
      // Expected: 1.0 * 0.35 * 0.72 = 0.252
      expect(bSignal?.score).toBeCloseTo(0.252);
    });
  });

  describe('Prop-003: Depth limit', () => {
    it('GIVEN PropagationEngine input "{\n          propagation: {\n            maxDepth: 2" WHEN PropagationEngine evaluates THEN not propagate beyond maxDepth', () => {
      // Arrange
      const aId: AnchorId = 'cap.A';
      const bId: AnchorId = 'cap.B';
      const cId: AnchorId = 'cap.C';
      const dId: AnchorId = 'cap.D';
      const adjacencyMap = new Map<AnchorId, AdjacencyEdge[]>();
      adjacencyMap.set(aId, [{ from: aId, to: bId, weight: 0.5 }]);
      adjacencyMap.set(bId, [{ from: bId, to: cId, weight: 0.5 }]);
      adjacencyMap.set(cId, [{ from: cId, to: dId, weight: 0.5 }]);

      const engine = new PropagationEngine(
        {
          propagation: {
            maxDepth: 2,
            decayFactor: 0.72,
            blockedKinds: [],
            minEdgeWeight: 0.1,
            maxExpandedAnchors: 1000,
          },
          direct: {
            minScore: 0.1,
          },
        } as RetrievalPolicy,
        adjacencyMap
      );

      const directSignals = new Map<AnchorId, MatchSignal>();
      directSignals.set(aId, createDirectSignal(aId, 1.0));

      // Act
      const expanded = engine.propagate(directSignals);

      // Assert
      // With maxDepth=2, we should get:
      // Depth 0: A (direct)
      // Depth 1: B (from A)
      // Depth 2: C (from B)
      // Depth 3: D (from C) -> should be blocked because depth >= maxDepth (2) when trying to go from C to D?
      // Let's check the code:
      //   if (depth >= this.policy.propagation.maxDepth) { return; }
      //   Then we process the edges from the current node.
      //   When we are at node C (depth=2), we check: depth (2) >= maxDepth (2) -> true, so we return without processing edges from C.
      //   Therefore, D should not be added.
      expect(expanded.has(aId)).toBe(true); // direct
      expect(expanded.has(bId)).toBe(true); // depth 1
      expect(expanded.has(cId)).toBe(true); // depth 2
      expect(expanded.has(dId)).toBe(false); // depth 3, not expanded because we stopped at depth 2
    });
  });

  describe('Prop-004: Blocked kinds', () => {
    it('GIVEN PropagationEngine input "{\n          propagation: {\n            maxDepth: 2" WHEN PropagationEngine evaluates THEN not propagate to blocked kinds', () => {
      // Arrange
      const aId: AnchorId = 'cap.A';
      const bId: AnchorId = 'beh.B'; // blocked kind
      const adjacencyMap = new Map<AnchorId, AdjacencyEdge[]>();
      adjacencyMap.set(aId, [{ from: aId, to: bId, weight: 0.5 }]);

      const engine = new PropagationEngine(
        {
          propagation: {
            maxDepth: 2,
            decayFactor: 0.72,
            blockedKinds: ['beh'],
            minEdgeWeight: 0.1,
            maxExpandedAnchors: 1000,
          },
          direct: {
            minScore: 0.1,
          },
        } as RetrievalPolicy,
        adjacencyMap
      );

      const directSignals = new Map<AnchorId, MatchSignal>();
      directSignals.set(aId, createDirectSignal(aId, 1.0));

      // Act
      const expanded = engine.propagate(directSignals);

      // Assert
      expect(expanded.has(aId)).toBe(true); // direct
      expect(expanded.has(bId)).toBe(false); // blocked
    });
  });

  describe('Prop-005: Min edge weight', () => {
    it('GIVEN PropagationEngine input "{\n          propagation: {\n            maxDepth: 2" WHEN PropagationEngine evaluates THEN ignore edges with weight below minEdgeWeight', () => {
      // Arrange
      const aId: AnchorId = 'cap.A';
      const bId: AnchorId = 'cap.B';
      const adjacencyMap = new Map<AnchorId, AdjacencyEdge[]>();
      adjacencyMap.set(aId, [{ from: aId, to: bId, weight: 0.05 }]); // below minEdgeWeight of 0.1

      const engine = new PropagationEngine(
        {
          propagation: {
            maxDepth: 2,
            decayFactor: 0.72,
            blockedKinds: [],
            minEdgeWeight: 0.1,
            maxExpandedAnchors: 1000,
          },
          direct: {
            minScore: 0.1,
          },
        } as RetrievalPolicy,
        adjacencyMap
      );

      const directSignals = new Map<AnchorId, MatchSignal>();
      directSignals.set(aId, createDirectSignal(aId, 1.0));

      // Act
      const expanded = engine.propagate(directSignals);

      // Assert
      expect(expanded.has(aId)).toBe(true); // direct
      expect(expanded.has(bId)).toBe(false); // edge ignored because weight < minEdgeWeight
    });
  });
});
