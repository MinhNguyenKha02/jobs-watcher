import { describe, it, expect } from 'vitest';
import {
  serializeMap,
  deserializeMap,
  serializeNestedSetMap,
  deserializeNestedSetMap,
} from '../../../../../src/domain/profile/artifacts/serializers/map.serializer.js';

describe('map.serializer', () => {
  describe('serializeMap / deserializeMap', () => {
    it('GIVEN map.serializer WHEN map.serializer evaluates THEN round-trips a Map<string, number>', () => {
      const original = new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ]);
      const serialized = serializeMap(original);
      const deserialized = deserializeMap(serialized);
      expect(deserialized).toEqual(original);
    });

    it('GIVEN map.serializer WHEN map.serializer evaluates THEN round-trips an empty Map', () => {
      const original = new Map();
      const serialized = serializeMap(original);
      const deserialized = deserializeMap(serialized);
      expect(deserialized).toEqual(original);
    });

    it('GIVEN map.serializer WHEN map.serializer evaluates THEN handles complex value types', () => {
      const original = new Map([
        ['k1', { id: 'x', values: [1, 2] }],
        ['k2', { id: 'y', values: [3] }],
      ]);
      const serialized = serializeMap(original);
      const deserialized = deserializeMap(serialized);
      expect(deserialized.get('k1')).toEqual({ id: 'x', values: [1, 2] });
    });
  });

  describe('serializeNestedSetMap / deserializeNestedSetMap', () => {
    it('GIVEN map.serializer WHEN map.serializer evaluates THEN round-trips a Map<string, Set<number>>', () => {
      const original = new Map([
        ['a', new Set([1, 2, 3])],
        ['b', new Set([4, 5])],
      ]);
      const serialized = serializeNestedSetMap(original);
      const deserialized = deserializeNestedSetMap(serialized);
      expect(deserialized).toEqual(original);
    });

    it('GIVEN map.serializer WHEN map.serializer evaluates THEN round-trips empty sets', () => {
      const original = new Map([['a', new Set()]]);
      const serialized = serializeNestedSetMap(original);
      const deserialized = deserializeNestedSetMap(serialized);
      expect(deserialized.get('a')).toEqual(new Set());
    });

    it('GIVEN map.serializer WHEN map.serializer evaluates THEN round-trips an empty Map (2)', () => {
      const original = new Map();
      const serialized = serializeNestedSetMap(original);
      const deserialized = deserializeNestedSetMap(serialized);
      expect(deserialized).toEqual(original);
    });

    it('GIVEN map.serializer WHEN map.serializer evaluates THEN preserves set membership order', () => {
      const original = new Map([['k', new Set(['c', 'a', 'b'])]]);
      const serialized = serializeNestedSetMap(original);
      const deserialized = deserializeNestedSetMap(serialized);
      expect([...deserialized.get('k')!]).toEqual(['c', 'a', 'b']);
    });
  });
});
