import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { config } from '../config.js';
import type { Job, Profile } from '../types.js';

/**
 * Smart Document Generator
 * Extracts job requirements and matches with profile skills
 * Generates job-specific CV, cover letter, and resume
 */
export class SmartGenerator {
  private profile: Profile;

  constructor(profile: Profile) {
    this.profile = profile;
  }

  /**
   * Extract job requirements from job description
   * Returns: skills needed, experience level, key responsibilities
   */
  extractJobRequirements(job: Job): {
    requiredSkills: string[];
    preferredSkills: string[];
    experienceLevel: string;
    responsibilities: string[];
  } {
    const description = (job.description || '').toLowerCase();
    const allText = `${job.position} ${job.company} ${description}`.toLowerCase();

    // Define skill extraction patterns
    const skillPatterns: Record<string, RegExp[]> = {
      'TypeScript': [/typescript|ts(?:\s|$)/, /typescript/i],
      'JavaScript': [/javascript|js(?:\s|$)/i],
      'React': [/react(?:\s|$)/i, /react\s+(?:native|web)/i],
      'Node.js': [/node\.?js/i, /node(?:\s|$)/i],
      'Python': [/python/i],
      'Go': [/golang|go(?:\s|$)/i],
      'Rust': [/rust/i],
      'Docker': [/docker/i],
      'Kubernetes': [/k8s|kubernetes/i],
      'AWS': [/aws|amazon\s+web\s+services/i],
      'GCP': [/google\s+cloud|gcp/i],
      'PostgreSQL': [/postgres|postgresql|psql/i],
      'MongoDB': [/mongodb|mongo/i],
      'Redis': [/redis/i],
      'GraphQL': [/graphql/i],
      'REST API': [/rest\s+api|restful/i],
      'CI/CD': [/ci\/cd|continuous\s+integration/i],
      'Git': [/git(?:\s|$)/i],
      'Linux': [/linux/i],
      'SQL': [/sql/i],
      'Microservices': [/microservices/i],
      'Testing': [/testing|jest|mocha|pytest/i],
    };

    // Extract required vs preferred
    const requiredSection = allText.match(/required[\s\S]*?(?:preferred|nice-to-have|$)/);
    const preferredSection = allText.match(/(?:preferred|nice-to-have)[\s\S]*?$/);

    const extractSkills = (text: string): string[] => {
      const found: string[] = [];
      Object.entries(skillPatterns).forEach(([skill, patterns]) => {
        if (patterns.some(p => p.test(text))) {
          found.push(skill);
        }
      });
      return [...new Set(found)];
    };

    const requiredSkills = extractSkills(requiredSection?.[0] || allText);
    const preferredSkills = extractSkills(preferredSection?.[0] || '');

    // Detect experience level
    const experienceLevel = this.detectExperienceLevel(allText);

    // Extract key responsibilities (sentences with action verbs)
    const responsibilities = this.extractResponsibilities(description);

    return {
      requiredSkills: [...new Set(requiredSkills)],
      preferredSkills: [...new Set(preferredSkills.filter(s => !requiredSkills.includes(s)))],
      experienceLevel,
      responsibilities,
    };
  }

  /**
   * Detect seniority level from job description
   */
  private detectExperienceLevel(text: string): string {
    if (/senior|lead|principal|architect|staff/i.test(text)) {
      return 'Senior';
    }
    if (/mid-level|intermediate|3-5 years/i.test(text)) {
      return 'Mid-Level';
    }
    if (/junior|entry-level|0-2 years|fresh|graduate/i.test(text)) {
      return 'Junior';
    }
    return 'Unspecified';
  }

  /**
   * Extract key responsibilities (action-verb sentences)
   */
  private extractResponsibilities(description: string): string[] {
    const actionVerbs = ['develop', 'build', 'design', 'implement', 'lead', 'manage', 'collaborate', 'optimize', 'improve', 'create'];
    
    const sentences = description.split(/[.!?]+/).filter(s => s.trim().length > 20);
    const responsibilities = sentences
      .filter(sentence =>
        actionVerbs.some(verb => new RegExp(`\\b${verb}`, 'i').test(sentence))
      )
      .slice(0, 5) // Top 5 responsibilities
      .map(s => s.trim());

    return responsibilities;
  }

  /**
   * Match profile skills with job requirements
   * Returns: skill match score (0-100), matched skills, missing skills
   */
  matchProfileWithJob(
    job: Job,
    requirements: ReturnType<typeof this.extractJobRequirements>
  ): {
    matchScore: number;
    matchedSkills: string[];
    missingSkills: string[];
    relevantExperience: string[];
  } {
    const normalizeSkill = (s: string) => s.toLowerCase().trim();
    const profileSkills = this.profile.skills.map(normalizeSkill);

    const skillMatchesProfile = (skill: string) => {
      const target = normalizeSkill(skill);
      return profileSkills.some(ps => ps.includes(target) || target.includes(ps));
    };

    const matchedRequired = requirements.requiredSkills.filter(skill => skillMatchesProfile(skill));
    const matchedPreferred = requirements.preferredSkills.filter(skill => skillMatchesProfile(skill));
    const matchedSkills = [...new Set([...matchedRequired, ...matchedPreferred])];

    // Find missing skills (compare case-insensitively)
    const missingSkills = requirements.requiredSkills.filter(reqSkill =>
      !matchedSkills.some(ms => normalizeSkill(ms) === normalizeSkill(reqSkill))
    );

    // Calculate score: matched / total
    const totalSkills = requirements.requiredSkills.length + requirements.preferredSkills.length;
    const matchScore = totalSkills > 0 ? Math.round(
      ((matchedRequired.length + matchedPreferred.length * 0.5) / totalSkills) * 100
    ) : 0;

    // Find relevant experience (companies/positions matching job keywords)
    const jobKeywords = [job.company, job.position, ...requirements.requiredSkills]
      .map(k => k?.toLowerCase())
      .filter(Boolean) as string[];
    
    const relevantExperience = this.profile.experience
      .filter(exp =>
        jobKeywords.some(kw =>
          exp.company.toLowerCase().includes(kw) ||
          exp.position.toLowerCase().includes(kw)
        )
      )
      .map(exp => `${exp.position} at ${exp.company}`);

    return {
      matchScore,
      matchedSkills: [...new Set(matchedSkills)],
      missingSkills,
      relevantExperience,
    };
  }

  /**
   * Generate job-specific CV with extracted requirements
   */
  async generateCV(
    job: Job,
    jobRequirements: ReturnType<typeof this.extractJobRequirements>,
    matching: ReturnType<typeof this.matchProfileWithJob>,
    outputDir: string
  ): Promise<void> {
    const templatePath = path.join(config.templatesPath, 'cv.tex');
    
    if (!fs.existsSync(templatePath)) {
      console.warn('⚠️  cv.tex template not found');
      return;
    }

    const template = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(template);

    // Select skills to highlight (prioritize job requirements)
    const highlightedSkills = [
      ...matching.matchedSkills.slice(0, 8),
      ...this.profile.skills
        .slice(0, 5)
        .map(s => s)
    ].slice(0, 12);

    // Select relevant experience
    const relevantExperience = this.profile.experience
      .slice(0, 3)
      .map(exp => ({
        ...exp,
        // Filter descriptions to relevant ones (if description is array, otherwise keep as is)
        description: Array.isArray(exp.description)
          ? exp.description.filter(d =>
              jobRequirements.requiredSkills.some(skill =>
                d.toLowerCase().includes(skill.toLowerCase())
              ) ||
              matching.matchedSkills.some(skill =>
                d.toLowerCase().includes(skill.toLowerCase())
              )
            )
          : exp.description,
      }));

    const context = {
      ...this.profile,
      skills: highlightedSkills,
      experience: relevantExperience,
      job: {
        company: job.company,
        position: job.position,
        platform: job.platform,
      },
      matching: {
        matchScore: matching.matchScore,
        requiredSkills: jobRequirements.requiredSkills.slice(0, 6),
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
    
    console.log(`  ✓ CV (match: ${matching.matchScore}%): ${outputPath}`);
  }

  /**
   * Generate job-specific cover letter
   */
  async generateCoverLetter(
    job: Job,
    jobRequirements: ReturnType<typeof this.extractJobRequirements>,
    matching: ReturnType<typeof this.matchProfileWithJob>,
    outputDir: string
  ): Promise<void> {
    const templatePath = path.join(config.templatesPath, 'cover-letter.md');
    
    if (!fs.existsSync(templatePath)) {
      console.warn('⚠️  cover-letter.md template not found');
      return;
    }

    const template = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(template);

    const context = {
      ...this.profile,
      job: {
        company: job.company,
        position: job.position,
        platform: job.platform,
        description: job.description,
      },
      matching: {
        matchScore: matching.matchScore,
        matchedSkills: matching.matchedSkills.slice(0, 5),
        relevantExperience: matching.relevantExperience.slice(0, 2),
      },
      requirements: {
        requiredSkills: jobRequirements.requiredSkills.slice(0, 5),
        responsibilities: jobRequirements.responsibilities.slice(0, 3),
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
    
    console.log(`  ✓ Cover Letter: ${outputPath}`);
  }

  /**
   * Generate job-specific resume
   */
  async generateResume(
    job: Job,
    jobRequirements: ReturnType<typeof this.extractJobRequirements>,
    matching: ReturnType<typeof this.matchProfileWithJob>,
    outputDir: string
  ): Promise<void> {
    const templatePath = path.join(config.templatesPath, 'resume.tex');
    
    if (!fs.existsSync(templatePath)) {
      console.warn('⚠️  resume.tex template not found');
      return;
    }

    const template = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(template);

    const context = {
      ...this.profile,
      skills: matching.matchedSkills.slice(0, 10),
      experience: this.profile.experience.slice(0, 2),
      job: {
        company: job.company,
        position: job.position,
        platform: job.platform,
      },
      matching: {
        matchScore: matching.matchScore,
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
    
    console.log(`  ✓ Resume: ${outputPath}`);
  }

  /**
   * Main entry point: Generate all documents for a job
   */
  async generateForJob(job: Job): Promise<string> {
    console.log(`\n📝 Generating application materials for ${job.company}...`);

    // Extract requirements from job
    const requirements = this.extractJobRequirements(job);
    console.log(`   Required skills: ${requirements.requiredSkills.join(', ')}`);

    // Match with profile
    const matching = this.matchProfileWithJob(job, requirements);
    console.log(`   Match score: ${matching.matchScore}%`);
    
    if (matching.missingSkills.length > 0) {
      console.log(`   ⚠️  Missing: ${matching.missingSkills.join(', ')}`);
    }

    // Create output directory
    const jobId = job.id ?? job.messageId ?? 'unknown';
    const outputDir = path.join(process.cwd(), 'generated', this.sanitizeFilename(jobId));
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate documents
    await Promise.all([
      this.generateCV(job, requirements, matching, outputDir),
      this.generateCoverLetter(job, requirements, matching, outputDir),
      this.generateResume(job, requirements, matching, outputDir),
    ]);

    return outputDir;
  }

  private sanitizeFilename(name: string): string {
    return name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }
}
