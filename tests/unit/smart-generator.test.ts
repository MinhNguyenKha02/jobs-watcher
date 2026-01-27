import fs from 'fs';
import path from 'path';
import { SmartGenerator } from '../../src/services/smart-generator';
import { mockProfile } from '../__fixtures__/emails';

describe('SmartGenerator', () => {
  const outputDir = path.join(process.cwd(), 'test-output');
  let generator: SmartGenerator;

  const job = {
    id: 'job-001',
    company: 'TechCorp',
    position: 'Senior Software Engineer',
    platform: 'LinkedIn' as const,
    location: 'Ho Chi Minh City',
    description: 'Looking for Node.js, TypeScript, React developer with 5+ years experience',
    url: 'https://example.com/job',
    emailId: 'email-1',
    subject: 'Senior Software Engineer',
    from: 'jobs@linkedin.com',
    receivedAt: new Date(),
    rawContent: '',
    status: 'queued' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(() => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  });

  beforeEach(() => {
    generator = new SmartGenerator(mockProfile as any);
  });

  describe('extractJobRequirements', () => {
    it('extracts skills and responsibilities', () => {
      const requirements = generator.extractJobRequirements(job);
      expect(requirements.requiredSkills).toContain('Node.js');
      expect(requirements.requiredSkills).toContain('TypeScript');
      expect(requirements.responsibilities.length).toBeGreaterThan(0);
    });

    it('detects experience level', () => {
      const senior = generator.extractJobRequirements({ ...job, position: 'Senior Engineer' });
      expect(senior.experienceLevel).toBe('Senior');
    });
  });

  describe('matchProfileWithJob', () => {
    it('scores overlap between job and profile', () => {
      const req = generator.extractJobRequirements(job);
      const matching = generator.matchProfileWithJob(job, req);
      expect(matching.matchScore).toBeGreaterThan(0);
      expect(matching.matchedSkills).toEqual(expect.arrayContaining(['Node.js', 'TypeScript', 'React']));
    });

    it('returns zero when no skills match', () => {
      const req = generator.extractJobRequirements({ ...job, description: 'Cobol and Fortran only' });
      const matching = generator.matchProfileWithJob({ ...job, description: 'Cobol and Fortran only' }, req);
      expect(matching.matchScore).toBe(0);
    });

    it('matches skills case-insensitively and reports missing accurately', () => {
      const requirements = {
        requiredSkills: ['TYPESCRIPT', 'react'],
        preferredSkills: ['node.js'],
        experienceLevel: 'Junior',
        responsibilities: [],
      };

      const matching = generator.matchProfileWithJob(job as any, requirements as any);
      expect(matching.matchedSkills).toEqual(expect.arrayContaining(['TYPESCRIPT', 'react', 'node.js']));
      expect(matching.missingSkills).not.toContain('TYPESCRIPT');
    });
  });

  describe('document generation', () => {
    it('writes CV, cover letter, and resume files', async () => {
      const requirements = generator.extractJobRequirements(job);
      const matching = generator.matchProfileWithJob(job, requirements);
      const dest = path.join(outputDir, 'smart-gen');

      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

      await generator.generateCV(job as any, requirements, matching, dest);
      await generator.generateCoverLetter(job as any, requirements, matching, dest);
      await generator.generateResume(job as any, requirements, matching, dest);

      const files = fs.readdirSync(dest);
      expect(files).toEqual(expect.arrayContaining(['cv.tex', 'cover-letter.md', 'resume.tex']));
    });
  });
});
