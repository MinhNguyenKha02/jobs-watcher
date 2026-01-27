import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { config } from '../config.js';
import type { Job, Profile } from '../types.js';

export interface GeneratorResult {
  success: boolean;
  outputDir?: string;
  errors: string[];
  generatedFiles: string[];
}

export class DocumentGenerator {
  private profile: Profile;
  private outputDir: string;

  constructor() {
    this.profile = this.loadProfile();
    this.outputDir = path.join(process.cwd(), 'generated');
    
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private loadProfile(): Profile {
    const profilePath = path.join(config.resourcesPath, 'profile.json');
    
    if (!fs.existsSync(profilePath)) {
      throw new Error('profile.json not found in resources/. Please create it.');
    }

    try {
      return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
    } catch (err) {
      throw new Error(`Failed to parse profile.json: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  /**
   * Enhanced generation with validation and error reporting
   */
  async generateForJobWithValidation(job: Job): Promise<GeneratorResult> {
    const errors: string[] = [];
    const generatedFiles: string[] = [];

    // Validate job data
    if (!job.id?.trim()) {
      errors.push('Missing job.id');
    }
    if (!job.company?.trim() || job.company === 'Unknown Company') {
      errors.push('Invalid job.company');
    }
    if (!job.position?.trim() || job.position === 'Unknown Position') {
      errors.push('Invalid job.position');
    }

    if (errors.length > 0) {
      return { success: false, errors, generatedFiles };
    }

    try {
      const jobDir = path.join(this.outputDir, this.sanitizeFilename(job.id));
      
      if (!fs.existsSync(jobDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
      }

      // Generate all documents and collect results
      const results = await Promise.all([
        this.generateCVWithValidation(job, jobDir),
        this.generateCoverLetterWithValidation(job, jobDir),
        this.generateResumeWithValidation(job, jobDir),
      ]);

      // Collect errors and files from all generations
      results.forEach(result => {
        errors.push(...result.errors);
        generatedFiles.push(...result.files);
      });

      return {
        success: errors.length === 0,
        outputDir: jobDir,
        errors,
        generatedFiles,
      };
    } catch (err) {
      errors.push(`Generation error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return { success: false, errors, generatedFiles };
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async generateForJob(job: Job): Promise<void> {
    const result = await this.generateForJobWithValidation(job);
    if (!result.success) {
      console.error('Generation errors:', result.errors);
    }
    if (result.outputDir) {
      console.log(`📁 Generated files in: ${result.outputDir}`);
    }
  }

  private async generateCVWithValidation(job: Job, outputDir: string): Promise<{ errors: string[]; files: string[] }> {
    const errors: string[] = [];
    const files: string[] = [];
    const templatePath = path.join(config.templatesPath, 'cv.tex');
    
    if (!fs.existsSync(templatePath)) {
      errors.push('cv.tex template not found');
      return { errors, files };
    }

    try {
      const template = fs.readFileSync(templatePath, 'utf-8');
      const compiled = Handlebars.compile(template);

      const context = {
        ...this.profile,
        job: {
          company: job.company || 'Unknown Company',
          position: job.position || 'Unknown Position',
          platform: job.platform || 'Unknown',
        },
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      };

      const output = compiled(context);
      const outputPath = path.join(outputDir, 'cv.tex');
      fs.writeFileSync(outputPath, output);
      files.push(outputPath);
      console.log(`  ✓ CV: ${outputPath}`);
    } catch (err) {
      errors.push(`CV generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    return { errors, files };
  }

  private async generateCoverLetterWithValidation(job: Job, outputDir: string): Promise<{ errors: string[]; files: string[] }> {
    const errors: string[] = [];
    const files: string[] = [];
    const templatePath = path.join(config.templatesPath, 'cover-letter.md');
    
    if (!fs.existsSync(templatePath)) {
      errors.push('cover-letter.md template not found');
      return { errors, files };
    }

    try {
      const template = fs.readFileSync(templatePath, 'utf-8');
      const compiled = Handlebars.compile(template);

      const context = {
        ...this.profile,
        job: {
          company: job.company || 'Unknown Company',
          position: job.position || 'Unknown Position',
          platform: job.platform || 'Unknown',
          description: job.description || 'No description provided',
        },
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      };

      const output = compiled(context);
      const outputPath = path.join(outputDir, 'cover-letter.md');
      fs.writeFileSync(outputPath, output);
      files.push(outputPath);
      console.log(`  ✓ Cover Letter: ${outputPath}`);
    } catch (err) {
      errors.push(`Cover Letter generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    return { errors, files };
  }

  private async generateResumeWithValidation(job: Job, outputDir: string): Promise<{ errors: string[]; files: string[] }> {
    const errors: string[] = [];
    const files: string[] = [];
    const templatePath = path.join(config.templatesPath, 'resume.tex');
    
    if (!fs.existsSync(templatePath)) {
      errors.push('resume.tex template not found');
      return { errors, files };
    }

    try {
      const template = fs.readFileSync(templatePath, 'utf-8');
      const compiled = Handlebars.compile(template);

      const context = {
        ...this.profile,
        job: {
          company: job.company || 'Unknown Company',
          position: job.position || 'Unknown Position',
          platform: job.platform || 'Unknown',
        },
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      };

      const output = compiled(context);
      const outputPath = path.join(outputDir, 'resume.tex');
      fs.writeFileSync(outputPath, output);
      files.push(outputPath);
      console.log(`  ✓ Resume: ${outputPath}`);
    } catch (err) {
      errors.push(`Resume generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    return { errors, files };
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }
}
