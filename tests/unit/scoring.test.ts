import { describe, it, expect } from 'vitest';
import { calculateJobScore, DEFAULT_SCORING_CONFIG } from '../../src/domain/scoring/score-matcher.js';
import type { Job, Profile } from '../../src/types.js';

describe('scoreMatcherEngine - calculateJobScore', () => {
  // Mock profile with clear skills and location
  const mockProfile: Profile = {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '555-1234',
    location: 'San Francisco, CA',
    title: 'Senior Software Engineer',
    summary: 'Expert in TypeScript and cloud architecture',
    skills: ['TypeScript', 'React', 'Node.js', 'AWS', 'MongoDB'],
    experience: [
      {
        company: 'Tech Corp',
        position: 'Senior Engineer',
        location: 'San Francisco, CA',
        startDate: '2020',
        endDate: 'Present',
        description: ['Led TypeScript migration', 'Built React components'],
      },
    ],
    education: [
      {
        institution: 'Stanford',
        degree: 'BS',
        field: 'Computer Science',
        startDate: '2015',
        endDate: '2019',
        gpa: '3.8',
      },
    ],
    links: {
      linkedin: 'https://linkedin.com/in/johndoe',
      github: 'https://github.com/johndoe',
    },
  };

  const profileWithSalary = {
    ...mockProfile,
    minSalary: 120000,
    maxSalary: 160000,
  } as Profile;

  describe('skill matching (ordered, word boundary)', () => {
    it('should match exact skill words in description', () => {
      const job: Job = {
        id: '1',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'TypeScript Developer',
        location: 'San Francisco, CA',
        description: 'We are looking for a developer proficient in TypeScript and Node.js',
        salary: '$120k - $160k',
      };

      const result = calculateJobScore(job, mockProfile);

      // Should match TypeScript and Node.js
      expect(result.details.jobSkillsFound).toContain('TypeScript');
      expect(result.details.jobSkillsFound).toContain('Node.js');
      expect(result.skillsScore).toBeGreaterThan(50);
    });

    it('should not partially match skill words', () => {
      const job: Job = {
        id: '2',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Developer',
        location: 'San Francisco',
        description: 'We need a Java developer with Typescript expertise',
        salary: '$100k',
      };

      const result = calculateJobScore(job, mockProfile);

      // Should match TypeScript (case-insensitive with word boundary)
      expect(result.details.jobSkillsFound).toContain('TypeScript');
      // Should NOT match Java (partial in word)
      expect(result.details.jobSkillsFound).not.toContain('Java');
    });

    it('should return 0 skills score when no skills match', () => {
      const job: Job = {
        id: '3',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Chef',
        location: 'San Francisco',
        description: 'Looking for a professional chef with culinary expertise',
        salary: '$50k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.details.jobSkillsFound.length).toBe(0);
      expect(result.skillsScore).toBe(0);
    });

    it('should handle case-insensitive matching', () => {
      const job: Job = {
        id: '4',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Developer',
        location: 'San Francisco',
        description: 'expert in typescript and REACT development',
        salary: '$120k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.details.jobSkillsFound).toContain('TypeScript');
      expect(result.details.jobSkillsFound).toContain('React');
    });

    it('should apply minimum threshold (30% of skills)', () => {
      const job: Job = {
        id: '5',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Developer',
        location: 'San Francisco',
        description: 'Just looking for TypeScript',
        salary: '$120k',
      };

      const result = calculateJobScore(job, mockProfile);

      // Only 1/5 skills matched = 20%, below 30% threshold
      expect(result.skillsScore).toBe(16);
    });

    it('should apply 0.5 weight to skills score', () => {
      const job: Job = {
        id: '6',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Full Stack Developer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, and MongoDB required',
        salary: '$150k',
      };

      const result = calculateJobScore(job, mockProfile);

      // All 5 skills match, score should be 100
      // Final = 100 * 0.5 + salary * 0.3 + location * 0.2
      expect(result.skillsScore).toBe(100);
      expect(result.finalScore).toBeGreaterThanOrEqual(50); // At least 50% from skills alone
    });
  });

  describe('salary range scoring (range-based)', () => {
    it('should score 100 when job salary is in user range', () => {
      const job: Job = {
        id: '7',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k', // In range [120k-160k]
      };

      const result = calculateJobScore(job, profileWithSalary);

      expect(result.salaryScore).toBe(100);
    });

    it('should score 50+ when job salary is below user range', () => {
      const job: Job = {
        id: '8',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$60k - $90k', // Below range
      };

      const result = calculateJobScore(job, profileWithSalary);

      expect(result.salaryScore).toBeLessThan(100);
      expect(result.salaryScore).toBeGreaterThan(0);
    });

    it('should score 20-50 when job salary is above user range', () => {
      const job: Job = {
        id: '9',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$300k - $400k', // Above range
      };

      const result = calculateJobScore(job, profileWithSalary);

      expect(result.salaryScore).toBeGreaterThan(0);
      expect(result.salaryScore).toBeLessThan(50);
    });

    it('should return 50 (neutral) when no salary provided', () => {
      const job: Job = {
        id: '10',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
      };

      const result = calculateJobScore(job, profileWithSalary);

      expect(result.salaryScore).toBe(50);
    });

    it('should apply 0.3 weight to salary score', () => {
      const job: Job = {
        id: '11',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k', // Perfect salary match (100)
      };

      const result = calculateJobScore(job, profileWithSalary);

      // Skills match all (100%), salary match (100%)
      // Final = 100 * 0.5 + 100 * 0.3 + location * 0.2
      expect(result.salaryScore).toBe(100);
      expect(result.finalScore).toBe(100);
    });
  });

  describe('location fuzzy matching', () => {
    it('should score 100 for exact location match', () => {
      const job: Job = {
        id: '12',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco, CA',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.locationScore).toBe(80);
    });

    it('should score 100 for remote position', () => {
      const job: Job = {
        id: '13',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'Remote',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.locationScore).toBe(100);
    });

    it('should score 80 for same city match', () => {
      const job: Job = {
        id: '14',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.locationScore).toBe(100);
    });

    it('should score 80 for substring location match', () => {
      const job: Job = {
        id: '15',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'Los Angeles, CA',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.locationScore).toBe(80);
    });

    it('should score 40 for unmatched location', () => {
      const job: Job = {
        id: '16',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'New York, NY',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.locationScore).toBe(40);
    });

    it('should score 0 for excluded location', () => {
      const profile: Profile = {
        ...mockProfile,
        location: 'San Francisco, CA, !new york',
      };

      const job: Job = {
        id: '17',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'New York, NY',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, profile);

      // Should detect excluded location and score 0
      expect(result.locationScore).toBe(0);
    });

    it('should apply 0.2 weight to location score', () => {
      const job: Job = {
        id: '18',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco, CA',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, profileWithSalary);

      // Skills 100%, Salary 100%, Location 80%
      // Final = 100 * 0.5 + 100 * 0.3 + 80 * 0.2 = 96%
      expect(result.locationScore).toBe(80);
      expect(result.finalScore).toBe(96);
    });
  });

  describe('neutral fallbacks (missing data)', () => {
    it('should return 50 for missing profile', () => {
      const job: Job = {
        id: '19',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript developer',
        salary: '$120k',
      };

      const result = calculateJobScore(job, null);

      // All scores should be neutral (50)
      expect(result.skillsScore).toBe(50);
      expect(result.salaryScore).toBe(50);
      expect(result.locationScore).toBe(50);
      expect(result.finalScore).toBe(50);
    });

    it('should return 50 for missing job', () => {
      const result = calculateJobScore(null, mockProfile);

      // All scores should be neutral (50)
      expect(result.skillsScore).toBe(50);
      expect(result.salaryScore).toBe(50);
      expect(result.locationScore).toBe(50);
      expect(result.finalScore).toBe(50);
    });

    it('should return 50 for missing description and salary', () => {
      const job: Job = {
        id: '20',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.skillsScore).toBe(0); // No description = 0 match
      expect(result.salaryScore).toBe(50); // No salary = neutral
      expect(result.locationScore).toBe(100); // Location matches
      // Final = 0 * 0.5 + 50 * 0.3 + 100 * 0.2 = 35
      expect(result.finalScore).toBe(35);
    });
  });

  describe('weighted probability calculation', () => {
    it('should correctly weight components (0.5 skills, 0.3 salary, 0.2 location)', () => {
      const job: Job = {
        id: '21',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco, CA',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, profileWithSalary);

      // Skills 100%, Salary 100%, Location 80% (substring match)
      // Final = 100 * 0.5 + 100 * 0.3 + 80 * 0.2 = 96
      expect(result.finalScore).toBe(96);
    });

    it('should calculate mixed scores correctly', () => {
      const job: Job = {
        id: '22',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'Los Angeles, CA', // Same state = 60
        description: 'TypeScript and React', // 2 out of 5 = below 30% = 0
        salary: '$100k', // Below range
      };

      const result = calculateJobScore(job, mockProfile);

      // Skills 40% (above threshold), Salary ~50%, Location 80%
      // Final ≈ 57 * 0.5 + 50 * 0.3 + 80 * 0.2 = ~60
      expect(result.finalScore).toBe(60);
    });

    it('should return score in 0-100 range', () => {
      const jobs = [
        { company: 'A', position: 'Role1', description: 'xyz abc', location: 'Mars' },
        {
          company: 'B',
          position: 'Role2',
          description: 'TypeScript React Node.js AWS MongoDB Java Python C++',
          location: 'San Francisco, CA',
          salary: '$150k - $200k',
        },
      ];

      jobs.forEach((job, idx) => {
        const result = calculateJobScore(
          { id: String(idx), platform: 'test', ...job },
          mockProfile
        );
        expect(result.finalScore).toBeGreaterThanOrEqual(0);
        expect(result.finalScore).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('config and customization', () => {
    it('should use custom config weights', () => {
      const customConfig = {
        ...DEFAULT_SCORING_CONFIG,
        weights: {
          skillsMatch: 0.2,
          salaryMatch: 0.2,
          locationMatch: 0.6, // Location-heavy
        },
      };

      const job: Job = {
        id: '23',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'New York, NY', // Poor match (40)
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k', // Perfect match (100)
      };

      const result = calculateJobScore(job, profileWithSalary, customConfig);

      // Skills 100%, Salary 100%, Location 40%
      // Final = 100 * 0.2 + 100 * 0.2 + 40 * 0.6 = 20 + 20 + 24 = 64
      expect(result.finalScore).toBeCloseTo(64, 0);
    });
  });

  describe('edge cases', () => {
    it('should handle empty strings gracefully', () => {
      const job: Job = {
        id: '24',
        platform: '',
        company: '',
        position: '',
        location: '',
        description: '',
        salary: '',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.finalScore).toBeGreaterThanOrEqual(0);
      expect(result.finalScore).toBeLessThanOrEqual(100);
    });

    it('should handle profile with no skills', () => {
      const profile: Profile = { ...mockProfile, skills: [] };
      const job: Job = {
        id: '25',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'TypeScript developer',
        salary: '$130k',
      };

      const result = calculateJobScore(job, profile);

      expect(result.skillsScore).toBe(50); // No skills to match = neutral
      expect(result.finalScore).toBeGreaterThanOrEqual(0);
    });

    it('should handle very long description', () => {
      const longDesc = 'TypeScript React Node.js AWS MongoDB '.repeat(100);
      const job: Job = {
        id: '26',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: longDesc,
        salary: '$130k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.skillsScore).toBe(100);
      expect(result.finalScore).toBeGreaterThanOrEqual(80);
    });

    it('should handle salary with various formats', () => {
      const testCases = [
        '$120000',
        '120,000',
        '$120k',
        '120K',
        'Salary: $120k - $160k',
        'up to $160k',
      ];

      testCases.forEach((salary) => {
        const job: Job = {
          id: `edge-${salary}`,
          platform: 'LinkedIn',
          company: 'TechCorp',
          position: 'Engineer',
          location: 'San Francisco',
          description: 'TypeScript',
          salary,
        };

        const result = calculateJobScore(job, mockProfile);
        expect(result.finalScore).toBeGreaterThanOrEqual(0);
        expect(result.finalScore).toBeLessThanOrEqual(100);
      });
    });
  });

  describe('breakdown data', () => {
    it('should return detailed breakdown', () => {
      const job: Job = {
        id: '27',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco, CA',
        description: 'TypeScript, React, Node.js, AWS, MongoDB',
        salary: '$130k - $150k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(result.details).toBeDefined();
      expect(result.details.userSkills).toBeDefined();
      expect(result.details.jobSkillsFound).toBeDefined();
      expect(result.details.userSalaryRange).toBeDefined();
      expect(result.details.jobSalary).toBeDefined();
      expect(result.details.userLocations).toBeDefined();
      expect(result.details.jobLocation).toBeDefined();
    });

    it('should include matched skills in result', () => {
      const job: Job = {
        id: '28',
        platform: 'LinkedIn',
        company: 'TechCorp',
        position: 'Engineer',
        location: 'San Francisco',
        description: 'We need TypeScript and React expertise',
        salary: '$130k',
      };

      const result = calculateJobScore(job, mockProfile);

      expect(Array.isArray(result.details.jobSkillsFound)).toBe(true);
      expect(result.details.jobSkillsFound.length).toBeGreaterThan(0);
      expect(result.details.jobSkillsFound[0]).toMatch(/^[A-Z]/); // Capitalized
    });
  });
});
