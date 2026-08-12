import { describe, it, expect } from 'vitest';

import { SkillKeyNormalizer } from '../../../../src/domain/profile/resume/normalization/skill-key-normalizer.js';

describe('SkillKeyNormalizer', () => {
  describe('Norm-001: kebab-case to title case', () => {
    it('GIVEN SkillKeyNormalizer WHEN SkillKeyNormalizer evaluates THEN replace hyphens with spaces and capitalize each word', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('event-driven-processing')).toBe(
        'Event Driven Processing'
      );
    });
  });

  describe('Norm-002: single word', () => {
    it('GIVEN SkillKeyNormalizer WHEN SkillKeyNormalizer evaluates THEN capitalize first letter and lowercase the rest', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('typescript')).toBe('Typescript');
    });
  });

  describe('Norm-002b: underscore separator', () => {
    it('GIVEN SkillKeyNormalizer WHEN SkillKeyNormalizer evaluates THEN handle underscore-separated keys', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('backend_framework')).toBe('Backend Framework');
    });
  });

  describe('Norm-004: mixed case input', () => {
    it('GIVEN input has uppercase WHEN SkillKeyNormalizer evaluates THEN lowercase non-first characters even', () => {
      expect(SkillKeyNormalizer.normalizeSkillName('API-Development')).toBe('Api Development');
    });
  });

  describe('mapCategoryToLabel', () => {
    it('GIVEN mapCategoryToLabel input "backend" WHEN mapCategoryToLabel evaluates THEN return mapped label for known category', () => {
      expect(SkillKeyNormalizer.mapCategoryToLabel('backend')).toBe('Backend');
    });

    it('GIVEN mapCategoryToLabel input "custom-zone" WHEN mapCategoryToLabel evaluates THEN normalize unknown category as fallback', () => {
      expect(SkillKeyNormalizer.mapCategoryToLabel('custom-zone')).toBe('Custom Zone');
    });
  });

  describe('getCategoryOrder', () => {
    it('GIVEN getCategoryOrder input "empty string" WHEN getCategoryOrder evaluates THEN return ordered list of category labels', () => {
      const order = SkillKeyNormalizer.getCategoryOrder();
      expect(order).toContain('Backend');
      expect(order[0]).toBe('Backend');
    });
  });
});
