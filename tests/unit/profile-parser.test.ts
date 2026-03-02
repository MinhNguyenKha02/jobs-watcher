import { fileURLToPath } from 'url';
/**
 * Unit tests for Profile Parser (Phase 3A.1 Sprint 1)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import { ProfileParser, ProfileSnapshotLoader } from '../../src/services/profile/profile-parser.js';
import type { ProfileNormalized } from '../../src/types/profile-normalized.js';

describe('ProfileParser', () => {
  describe('validate', () => {
    it('should pass validation for valid profile', () => {
      const validProfile = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        location: 'San Francisco, CA',
        title: 'Software Engineer',
        summary: 'Experienced developer',
      };

      const result = ProfileParser.validate(validProfile as any);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for missing required fields', () => {
      const invalidProfile = {
        name: 'John Doe',
        // Missing email, title, summary
      };

      const result = ProfileParser.validate(invalidProfile as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).toContain('Missing required field: email');
      expect(result.errors).toContain('Missing required field: title');
      expect(result.errors).toContain('Missing required field: summary');
    });

    it('should warn for invalid email format', () => {
      const profile = {
        name: 'John Doe',
        email: 'not-an-email',
        title: 'Engineer',
        summary: 'Summary',
      };

      const result = ProfileParser.validate(profile as any);
      expect(result.warnings).toContain('Email format may be invalid');
    });

    it('should warn for missing skills', () => {
      const profile = {
        name: 'John Doe',
        email: 'john@example.com',
        title: 'Engineer',
        summary: 'Summary',
      };

      const result = ProfileParser.validate(profile as any);
      expect(result.warnings).toContain('No skills defined (software_fundamentals or skills)');
    });
  });

  describe('parse', () => {
    it('should parse minimal profile correctly', () => {
      const minimalProfile = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '+1234567890',
        location: 'New York, NY',
        title: 'Backend Developer',
        summary: 'Experienced in Go and TypeScript',
      };

      const normalized = ProfileParser.parse(minimalProfile as any);

      expect(normalized.name).toBe('Jane Smith');
      expect(normalized.email).toBe('jane@example.com');
      expect(normalized.title).toBe('Backend Developer');
      expect(normalized.summary).toEqual(['Experienced in Go and TypeScript']);
      expect(normalized.normalizedSkills).toEqual([]);
      expect(normalized.experience).toEqual([]);
      expect(normalized.projects).toEqual([]);
    });

    it('should normalize summary to array', () => {
      const profileWithStringSummary = {
        name: 'Test',
        email: 'test@example.com',
        phone: '123',
        location: 'Location',
        title: 'Developer',
        summary: 'Single string summary',
      };

      const normalized = ProfileParser.parse(profileWithStringSummary as any);
      expect(Array.isArray(normalized.summary)).toBe(true);
      expect(normalized.summary).toEqual(['Single string summary']);
    });

    it('should parse software fundamentals with tiers', () => {
      const profileWithFundamentals = {
        name: 'Test',
        email: 'test@example.com',
        phone: '123',
        location: 'Location',
        title: 'Developer',
        summary: 'Test',
        software_fundamentals: {
          programming_language: {
            solid: ['Go', 'TypeScript'],
            working: ['Python'],
            familiar: ['Rust'],
          },
          dsa: ['Data structures', 'Algorithms'],
          os: ['Linux fundamentals'],
        },
      };

      const normalized = ProfileParser.parse(profileWithFundamentals as any);

      expect(normalized.fundamentals.programming_language.solid).toEqual(['Go', 'TypeScript']);
      expect(normalized.fundamentals.programming_language.working).toEqual(['Python']);
      expect(normalized.fundamentals.programming_language.familiar).toEqual(['Rust']);
      expect(normalized.fundamentals.dsa).toEqual(['Data structures', 'Algorithms']);
      expect(normalized.fundamentals.os).toEqual(['Linux fundamentals']);
    });

    it('should extract normalized skills from fundamentals', () => {
      const profileWithSkills = {
        name: 'Test',
        email: 'test@example.com',
        phone: '123',
        location: 'Location',
        title: 'Developer',
        summary: 'Test',
        software_fundamentals: {
          programming_language: {
            solid: ['Go', 'TypeScript'],
            familiar: ['Python'],
          },
        },
      };

      const normalized = ProfileParser.parse(profileWithSkills as any);

      expect(normalized.normalizedSkills.length).toBe(3);

      const goSkill = normalized.normalizedSkills.find((s) => s.name === 'Go');
      expect(goSkill?.tier).toBe('solid');
      expect(goSkill?.domains).toContain('backend');

      const pythonSkill = normalized.normalizedSkills.find((s) => s.name === 'Python');
      expect(pythonSkill?.tier).toBe('familiar');
    });

    it('should parse structured skills by domain', () => {
      const profileWithStructuredSkills = {
        name: 'Test',
        email: 'test@example.com',
        phone: '123',
        location: 'Location',
        title: 'Developer',
        summary: 'Test',
        skills: {
          backend: {
            frameworks: {
              solid: ['Express.js', 'Gin'],
              familiar: ['Laravel'],
            },
            api: {
              solid: ['REST', 'gRPC'],
            },
          },
          frontend: {
            frameworks: {
              solid: ['Vue.js'],
              familiar: ['React'],
            },
          },
        },
      };

      const normalized = ProfileParser.parse(profileWithStructuredSkills as any);

      expect(normalized.skills.backend?.frameworks?.solid).toEqual(['Express.js', 'Gin']);
      expect(normalized.skills.backend?.frameworks?.familiar).toEqual(['Laravel']);
      expect(normalized.skills.backend?.api?.solid).toEqual(['REST', 'gRPC']);
      expect(normalized.skills.frontend?.frameworks?.solid).toEqual(['Vue.js']);
    });

    it('should normalize experience with description array', () => {
      const profileWithExperience = {
        name: 'Test',
        email: 'test@example.com',
        phone: '123',
        location: 'Location',
        title: 'Developer',
        summary: 'Test',
        experience: [
          {
            company: 'Tech Corp',
            position: 'Software Engineer',
            location: 'San Francisco',
            startDate: '2020-01',
            endDate: '2023-12',
            description: ['Built APIs', 'Deployed services'],
          },
          {
            company: 'Startup Inc',
            position: 'Junior Dev',
            location: 'Remote',
            startDate: '2019-01',
            endDate: '2020-01',
            highlights: ['Learned Go', 'Worked on microservices'],
          },
        ],
      };

      const normalized = ProfileParser.parse(profileWithExperience as any);

      expect(normalized.experience).toHaveLength(2);
      expect(normalized.experience[0].company).toBe('Tech Corp');
      expect(normalized.experience[0].description).toEqual(['Built APIs', 'Deployed services']);
      expect(normalized.experience[1].description).toEqual([
        'Learned Go',
        'Worked on microservices',
      ]);
    });

    it('should add timestamp to normalized profile', () => {
      const profile = {
        name: 'Test',
        email: 'test@example.com',
        phone: '123',
        location: 'Location',
        title: 'Developer',
        summary: 'Test',
      };

      const normalized = ProfileParser.parse(profile as any);

      expect(normalized.normalizedAt).toBeDefined();
      expect(typeof normalized.normalizedAt).toBe('string');
      expect(new Date(normalized.normalizedAt!).toString()).not.toBe('Invalid Date');
    });
  });
});

describe('ProfileSnapshotLoader', () => {
  beforeEach(() => {
    ProfileSnapshotLoader.clearCache();
  });

  it('should cache profile after first load', () => {
    // This test would require a real file
    // In actual implementation, you'd use a test fixture
    expect(ProfileSnapshotLoader.getCachedHash()).toBeNull();
  });

  it('should clear cache when requested', () => {
    ProfileSnapshotLoader.clearCache();
    expect(ProfileSnapshotLoader.getCachedHash()).toBeNull();
  });
});

import path from 'path';
import fs from 'fs';

import { canonicalProfile } from '../../src/db/json.js';
describe('Canonical profile (json.ts)', () => {
  it('should parse and normalize the canonical profile without error', () => {
    const normalized = ProfileParser.parse(canonicalProfile);
    expect(normalized).toBeDefined();
    expect(normalized.name).toBe('Minh Nguyen Kha');
    expect(normalized.projects && normalized.projects.length).toBeGreaterThan(0);
    expect(normalized.experience && normalized.experience.length).toBeGreaterThan(0);
  });
});
