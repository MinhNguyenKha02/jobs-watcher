/**
 * Unit tests for Draft Builder (Phase 3A.1 Sprint 1)
 */

import { describe, it, expect } from '@jest/globals';
import { DraftBuilder } from '../../src/services/profile/draft-builder.js';
import type { Job } from '../../src/types.js';
import type { ProfileNormalized } from '../../src/types/profile-normalized.js';

describe('DraftBuilder', () => {
  // Mock profile for testing
  const mockProfile: ProfileNormalized = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1234567890',
    location: 'San Francisco, CA',
    title: 'Full-Stack Developer',
    summary: [
      'Experienced software engineer with 3 years in backend and frontend development.',
      'Proficient in Go, TypeScript, and modern web frameworks.',
    ],
    fundamentals: {
      programming_language: {
        solid: ['Go', 'TypeScript'],
        working: ['Python'],
        familiar: ['Rust'],
      },
      dsa: ['Data structures', 'Algorithms'],
      os: ['Linux fundamentals'],
      oop: ['OOP principles', 'SOLID'],
      database: ['SQL', 'NoSQL'],
      networking: ['TCP/IP', 'HTTP'],
      security: ['Authentication', 'Authorization'],
      test: ['Unit testing', 'Integration testing'],
      ai: [],
    },
    skills: {
      backend: {
        frameworks: {
          solid: ['Express.js', 'Gin'],
          working: [],
          familiar: ['Laravel'],
        },
        api: {
          solid: ['REST', 'gRPC'],
          working: [],
          familiar: ['GraphQL'],
        },
        database: {
          solid: ['PostgreSQL', 'MongoDB'],
          working: ['Redis'],
          familiar: [],
        },
      },
      frontend: {
        frameworks: {
          solid: ['Vue.js'],
          working: [],
          familiar: ['React'],
        },
      },
      devops: {
        containerization: {
          solid: [],
          working: ['Docker'],
          familiar: [],
        },
        ci_cd: ['GitHub Actions', 'Git'],
        cloud: {
          solid: [],
          working: ['AWS'],
          familiar: [],
        },
      },
      tooling: ['Git', 'VSCode'],
    },
    normalizedSkills: [
      { name: 'Go', tier: 'solid', evidence: ['work'], domains: ['backend'] },
      { name: 'TypeScript', tier: 'solid', evidence: ['work'], domains: ['backend'] },
      { name: 'Express.js', tier: 'solid', evidence: ['work'], domains: ['backend'] },
      { name: 'Gin', tier: 'solid', evidence: ['work'], domains: ['backend'] },
      { name: 'REST', tier: 'solid', evidence: ['work'], domains: ['backend'] },
      { name: 'PostgreSQL', tier: 'solid', evidence: ['work'], domains: ['database'] },
      { name: 'MongoDB', tier: 'solid', evidence: ['work'], domains: ['database'] },
      { name: 'Vue.js', tier: 'solid', evidence: ['work'], domains: ['frontend'] },
      { name: 'Docker', tier: 'working', evidence: ['lab'], domains: ['devops'] },
      { name: 'React', tier: 'familiar', evidence: ['work'], domains: ['frontend'] },
    ],
    projects: [
      {
        name: 'Microservices API',
        period: '2023-01 - 2024-01',
        summary: 'Built REST APIs with Go and PostgreSQL',
        tech: ['Go', 'PostgreSQL', 'Docker', 'Gin'],
      },
      {
        name: 'E-commerce Frontend',
        period: '2022-06 - 2023-01',
        summary: 'Developed Vue.js application with TypeScript',
        tech: ['Vue.js', 'TypeScript', 'REST'],
      },
    ],
    experience: [
      {
        company: 'Tech Corp',
        position: 'Software Engineer',
        location: 'San Francisco, CA',
        startDate: '2021-01',
        endDate: '2024-01',
        description: [
          'Developed backend services with Go and Express.js',
          'Built RESTful APIs serving 100K+ requests/day',
          'Deployed containerized applications with Docker',
        ],
      },
    ],
    education: [
      {
        institution: 'University of California',
        degree: 'Bachelor of Science',
        field: 'Computer Science',
        startDate: '2017',
        endDate: '2021',
        gpa: '3.8/4.0',
      },
    ],
    links: {
      github: 'https://github.com/janedoe',
      linkedin: 'https://linkedin.com/in/janedoe',
    },
    profileHash: 'abc123hash',
    normalizedAt: '2026-02-15T10:00:00Z',
  };

  // Mock job for testing
  const mockJob: Job = {
    id: 'job-001',
    platform: 'LinkedIn',
    company: 'Awesome Startup',
    position: 'Backend Engineer',
    location: 'San Francisco, CA',
    description: 'Looking for a backend engineer with Go and PostgreSQL experience.',
    details: {
      requirements: 'Required: Go, PostgreSQL, REST APIs, Docker. Preferred: TypeScript, microservices experience.',
      responsibilities: 'Build scalable backend services, design REST APIs, deploy with Docker.',
    },
    url: 'https://example.com/job/001',
  };

  describe('build', () => {
    it('should create draft with all required fields', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      expect(draft.jobId).toBe('job-001');
      expect(draft.jobTitle).toBe('Backend Engineer');
      expect(draft.company).toBe('Awesome Startup');
      expect(draft.sections).toBeDefined();
      expect(draft.sections.length).toBeGreaterThan(0);
      expect(draft.matchedSkills).toBeDefined();
      expect(draft.skillGaps).toBeDefined();
      expect(draft.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(draft.relevanceScore).toBeLessThanOrEqual(1);
      expect(draft.evidenceMappings).toBeDefined();
      expect(draft.draftedAt).toBeDefined();
      expect(draft.profileHash).toBe('abc123hash');
    });

    it('should match skills correctly', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      expect(draft.matchedSkills).toContain('Go');
      expect(draft.matchedSkills).toContain('PostgreSQL');
      expect(draft.matchedSkills).toContain('REST');
      expect(draft.matchedSkills).toContain('Docker');
    });

    it('should calculate relevance score based on match quality', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      // Should have high relevance since profile matches required skills
      expect(draft.relevanceScore).toBeGreaterThan(0.5);
    });

    it('should identify skill gaps', () => {
      const jobWithExtraSkills: Job = {
        ...mockJob,
        details: {
          requirements: 'Required: Go, Kubernetes, Terraform, Rust',
        },
      };

      const draft = DraftBuilder.build(mockProfile, jobWithExtraSkills);

      // Profile doesn't have Kubernetes or Terraform as solid skills
      expect(draft.skillGaps).toContain('kubernetes');
      expect(draft.skillGaps.length).toBeGreaterThan(0);
    });

    it('should order sections by priority and relevance', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      // Summary should always be first
      expect(draft.sections[0].type).toBe('summary');

      // Skills should be high priority when many matches
      const skillsSection = draft.sections.find(s => s.type === 'skills');
      expect(skillsSection).toBeDefined();
      expect(skillsSection!.priority).toBeLessThanOrEqual(3);
    });

    it('should include evidence mappings for matched skills', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      const goEvidence = draft.evidenceMappings.find(e => e.skill === 'Go');
      expect(goEvidence).toBeDefined();
      expect(goEvidence!.tier).toBe('solid');
      expect(goEvidence!.evidence.length).toBeGreaterThan(0);
    });

    it('should create deterministic output for same inputs', () => {
      const draft1 = DraftBuilder.build(mockProfile, mockJob);
      const draft2 = DraftBuilder.build(mockProfile, mockJob);

      // Matched skills should be identical
      expect(draft1.matchedSkills).toEqual(draft2.matchedSkills);
      
      // Section order should be identical
      expect(draft1.sections.map(s => s.type)).toEqual(draft2.sections.map(s => s.type));
    });

    it('should handle job with no description gracefully', () => {
      const minimalJob: Job = {
        platform: 'Email',
        company: 'Unknown Company',
        position: 'Developer',
      };

      const draft = DraftBuilder.build(mockProfile, minimalJob);

      expect(draft).toBeDefined();
      expect(draft.matchedSkills).toBeDefined();
      expect(draft.sections).toBeDefined();
    });

    it('should prioritize solid skills over working/familiar', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      const solidSkills = draft.evidenceMappings
        .filter(e => e.tier === 'solid')
        .map(e => e.skill);

      const familiarSkills = draft.evidenceMappings
        .filter(e => e.tier === 'familiar')
        .map(e => e.skill);

      // Solid skills should appear first in matched skills
      const firstMatches = draft.matchedSkills.slice(0, 3);
      const hasSolid = firstMatches.some(s => solidSkills.includes(s));
      expect(hasSolid).toBe(true);
    });

    it('should build summary section with job-specific skills', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      const summarySection = draft.sections.find(s => s.type === 'summary');
      expect(summarySection).toBeDefined();
      expect(summarySection!.content).toContain(mockJob.company);
      expect(summarySection!.priority).toBe(1);
      expect(summarySection!.relevance).toBe(1.0);
    });

    it('should build skills section with tiered skills', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      const skillsSection = draft.sections.find(s => s.type === 'skills');
      expect(skillsSection).toBeDefined();
      expect(skillsSection!.content).toContain('Proficient');
    });

    it('should prioritize projects with matched tech', () => {
      const draft = DraftBuilder.build(mockProfile, mockJob);

      const projectsSection = draft.sections.find(s => s.type === 'projects');
      expect(projectsSection).toBeDefined();
      
      // Should mention the Microservices API project since it uses Go and PostgreSQL
      expect(projectsSection!.content).toContain('Microservices API');
    });
  });

  describe('edge cases', () => {
    it('should handle profile with no skills', () => {
      const minimalProfile: ProfileNormalized = {
        ...mockProfile,
        normalizedSkills: [],
        projects: [],
      };

      const draft = DraftBuilder.build(minimalProfile, mockJob);

      expect(draft.matchedSkills).toHaveLength(0);
      expect(draft.relevanceScore).toBeLessThanOrEqual(0.5);
    });

    it('should handle job with no requirements', () => {
      const vagueJob: Job = {
        platform: 'Email',
        company: 'Company',
        position: 'Engineer',
        description: 'We are hiring engineers.',
      };

      const draft = DraftBuilder.build(mockProfile, vagueJob);

      expect(draft).toBeDefined();
      expect(draft.relevanceScore).toBeGreaterThanOrEqual(0);
    });
  });
});
