import { describe, it, expect } from 'vitest';

import { BulletSelector } from '../../../../src/domain/profile/resume/resolve/bullet-selector.js';

describe('BulletSelector', () => {
  let selector: BulletSelector;

  beforeEach(() => {
    selector = new BulletSelector();
  });

  describe('Bullet-001: topK returns longest bullets', () => {
    it('GIVEN BulletSelector WHEN BulletSelector evaluates THEN sort bullets by length descending and return top K', () => {
      const bullets = ['a', 'longer bullet here', 'medium', 'very long bullet text indeed'];
      const result = selector.topK(bullets, 2);
      expect(result).toEqual(['very long bullet text indeed', 'longer bullet here']);
    });
  });

  describe('Bullet-002: topK with default limit', () => {
    it('GIVEN BulletSelector WHEN BulletSelector evaluates THEN default to limit of 4', () => {
      const bullets = Array.from({ length: 6 }, (_, i) => 'x'.repeat(i + 1));
      const result = selector.topK(bullets);
      expect(result.length).toBe(4);
      expect(result[0]).toBe('xxxxxx');
      expect(result[3]).toBe('xxx');
    });
  });

  describe('Bullet-003: topK fewer bullets than limit', () => {
    it('GIVEN fewer than limit WHEN BulletSelector evaluates THEN return all bullets', () => {
      const bullets = ['short', 'medium length'];
      const result = selector.topK(bullets, 5);
      expect(result).toEqual(['medium length', 'short']);
    });
  });
});
