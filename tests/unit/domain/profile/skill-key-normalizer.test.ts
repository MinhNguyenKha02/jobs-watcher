import { describe, it, expect } from 'vitest';
import { SkillKeyNormalizer } from '../../../../src/domain/profile/resume/normalization/skill-key-normalizer.js' ;

describe('SkillKeyNormalizer', () => {
  describe('Norm-001: kebab-case to title case', () => {
    it('should replace hyphens with spaces and capitalize each word', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('event-driven-processing')).toBe('Event Driven Processing');
    });
  });

  describe('Norm-002: single word', () => {
    it('should capitalize first letter and lowercase the rest', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('typescript')).toBe('Typescript');
    });
  });

  describe('Norm-002b: underscore separator', () => {
    it('should handle underscore-separated keys', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('backend_framework')).toBe('Backend Framework');
    });
  });

  describe('Norm-004: mixed case input', () => {
    it('should lowercase non-first characters even if input has uppercase', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('API-Development')).toBe('Api Development');
    });
  });

  describe('mapCategoryToLabel', () => {
    it('should return mapped label for known category', () => {
      expect(SkillKeyNormalizer.mapCategoryToLabel('backend')).toBe('Backend');
    });

    it('should normalize unknown category as fallback', () => {
      expect(SkillKeyNormalizer.mapCategoryToLabel('custom-zone')).toBe('Custom Zone');
    });
  });

  describe('getCategoryOrder', () => {
    it('should return ordered list of category labels', () => {
      const order = SkillKeyNormalizer.getCategoryOrder();
      expect(order).toContain('Backend');
      expect(order[0]).toBe('Backend');
    });
  });
});
