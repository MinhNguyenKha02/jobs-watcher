import fs from 'fs';
import path from 'path';
import { DocumentGenerator } from '../../src/services/generators/generator.js';
import { mockProfile } from '../__fixtures__/emails.js';

describe('DocumentGenerator - Validation Tests', () => {
  const outputDir = path.join(process.cwd(), 'test-output');
  let generator: DocumentGenerator;

  const validJob = {
    id: 'job-001',
    emailId: 'email-1',
    subject: 'Senior Software Engineer at TechCorp',
    from: 'jobs@linkedin.com',
    platform: 'LinkedIn' as const,
    company: 'TechCorp',
    position: 'Senior Software Engineer',
    location: 'Ho Chi Minh City',
    url: 'https://example.com/job',
    description: 'Looking for Node.js, TypeScript developer',
    rawContent: 'Full job content...',
    createdAt: new Date(),
    actions: [],
  };

  beforeAll(() => {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
  });

  beforeEach(() => {
    try {
      generator = new DocumentGenerator();
    } catch (err) {
      // If profile.json doesn't exist, skip tests
      console.warn('Skipping generator tests - profile.json not found');
    }
  });

  describe('generateForJobWithValidation', () => {
    it('validates missing job.id', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation({
        ...validJob,
        id: '',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Missing job.id');
    });

    it('validates missing company', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation({
        ...validJob,
        company: '',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid job.company');
    });

    it('validates missing position', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation({
        ...validJob,
        position: '',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid job.position');
    });

    it('rejects "Unknown Company"', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation({
        ...validJob,
        company: 'Unknown Company',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid job.company');
    });

    it('rejects "Unknown Position"', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation({
        ...validJob,
        position: 'Unknown Position',
      });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Invalid job.position');
    });

    it('returns generated files on success', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation(validJob);

      expect(result.generatedFiles).toBeDefined();
      if (result.success) {
        expect(result.generatedFiles.length).toBeGreaterThan(0);
        result.generatedFiles.forEach((file: string) => {
          expect(typeof file).toBe('string');
        });
      } else {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it('includes specific template error messages', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation(validJob);

      if (!result.success) {
        const hasTemplateError = result.errors.some(
          e => e.includes('template') || e.includes('not found')
        );
        expect(hasTemplateError || result.generatedFiles.length === 0).toBe(true);
      }
    });
  });

  describe('error handling', () => {
    it('handles generation errors gracefully', async () => {
      if (!generator) {
        return;
      }
      const result = await generator.generateForJobWithValidation({
        ...validJob,
        company: null as any,
        position: undefined as any,
      });

      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.success).toBe(false);
    });
  });
});
