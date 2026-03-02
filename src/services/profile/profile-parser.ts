

import type { Profile } from '../../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type {
  ProfileNormalized,
  ProfileValidationResult,
  NormalizedSkill,
  SkillTier,
  EvidenceType,
  SoftwareFundamentals,
  StructuredSkills,
} from '../../types/profile-normalized.js';

interface CanonicalProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  title: string;
  summary: string | string[];
  software_fundamentals?: Record<string, any>;
  skills?: Record<string, any>;
  projects?: any[];
  experience?: any[];
  education?: any[];
  links?: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    website?: string;
  };
}


export class ProfileParser {
  /**
   * Denormalize: Convert a ProfileNormalized to a flat Profile (for SmartGenerator, scoring, etc)
   */
  static deNormaliseProfile(profileNorm: ProfileNormalized): Profile {
    const skills: string[] = Array.isArray(profileNorm.normalizedSkills)
      ? profileNorm.normalizedSkills.map((s) => s.name)
      : [];
    return {
      name: profileNorm.name,
      email: profileNorm.email,
      phone: profileNorm.phone,
      location: profileNorm.location,
      title: profileNorm.title,
      summary: Array.isArray(profileNorm.summary) ? profileNorm.summary.join(' ') : (profileNorm.summary || ''),
      skills,
      experience: Array.isArray(profileNorm.experience) ? profileNorm.experience.map((exp) => ({
        company: exp.company,
        position: exp.position,
        location: exp.location,
        startDate: exp.startDate,
        endDate: exp.endDate,
        description: Array.isArray(exp.description) ? exp.description : [],
      })) : [],
      education: Array.isArray(profileNorm.education) ? profileNorm.education.map((edu) => ({
        institution: edu.institution,
        degree: edu.degree,
        field: edu.field,
        startDate: edu.startDate,
        endDate: edu.endDate,
        gpa: edu.gpa,
      })) : [],
      links: profileNorm.links || {},
    };
  }

  /**
   * Load and parse canonical profile from file
   */
  static loadFromFile(filePath: string): ProfileNormalized {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Profile file not found: ${filePath}`);
    }
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const canonical = JSON.parse(rawContent) as CanonicalProfile;
    // Calculate hash of raw content for immutability tracking
    const profileHash = crypto
      .createHash('sha256')
      .update(rawContent)
      .digest('hex');
    return this.parse(canonical, profileHash);
  }

  /**
   * Parse canonical profile into normalized format
   */
  static parse(canonical: CanonicalProfile, profileHash?: string): ProfileNormalized {
    // Validate required fields
    const validation = this.validate(canonical);
    if (!validation.valid) {
      throw new Error(`Profile validation failed:\n${validation.errors.join('\n')}`);
    }
    // Normalize summary to array
    const summary = Array.isArray(canonical.summary)
      ? canonical.summary
      : [canonical.summary];
    // Parse fundamentals
    const fundamentals = this.parseFundamentals(canonical.software_fundamentals || {});
    // Parse structured skills
    const skills = this.parseStructuredSkills(canonical.skills || {});
    // Extract flat normalized skills for matching
    const normalizedSkills = this.extractNormalizedSkills(
      fundamentals,
      skills,
      canonical.projects || []
    );
    // Normalize experience
    const experience = (canonical.experience || []).map(exp => ({
      company: exp.company || '',
      position: exp.position || '',
      location: exp.location || '',
      startDate: exp.startDate || '',
      endDate: exp.endDate || '',
      description: Array.isArray(exp.description)
        ? exp.description
        : exp.highlights || [],
    }));
    return {
      name: canonical.name,
      email: canonical.email,
      phone: canonical.phone,
      location: canonical.location,
      title: canonical.title,
      summary,
      fundamentals,
      skills,
      normalizedSkills,
      projects: canonical.projects || [],
      experience,
      education: canonical.education || [],
      links: canonical.links || {},
      profileHash,
      normalizedAt: new Date().toISOString(),
    };
  }

  /**
   * Validate canonical profile structure
   */
  static validate(canonical: CanonicalProfile): ProfileValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    // Required fields
    const requiredFields = ['name', 'email', 'title', 'summary'];
    for (const field of requiredFields) {
      if (!canonical[field as keyof CanonicalProfile]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    // Email format validation
    if (canonical.email && !this.isValidEmail(canonical.email)) {
      warnings.push('Email format may be invalid');
    }
    // Skills validation
    if (!canonical.software_fundamentals && !canonical.skills) {
      warnings.push('No skills defined (software_fundamentals or skills)');
    }
    // Experience validation
    if (!canonical.experience || canonical.experience.length === 0) {
      warnings.push('No work experience defined');
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Parse software fundamentals
   */
  private static parseFundamentals(raw: Record<string, any>): SoftwareFundamentals {
    const defaults: SoftwareFundamentals = {
      programming_language: { solid: [], working: [], familiar: [] },
      dsa: [],
      os: [],
      oop: [],
      database: [],
      networking: [],
      security: [],
      test: [],
      ai: [],
    };
    if (!raw || typeof raw !== 'object') return defaults;
    // Parse programming_language with tiers
    if (raw.programming_language && typeof raw.programming_language === 'object') {
      defaults.programming_language = {
        solid: raw.programming_language.solid || [],
        working: raw.programming_language.working || [],
        familiar: raw.programming_language.familiar || [],
      };
    }
    // Parse other fundamentals (arrays)
    const fundamentalKeys = ['dsa', 'os', 'oop', 'database', 'networking', 'security', 'test', 'ai'];
    for (const key of fundamentalKeys) {
      if (Array.isArray(raw[key])) {
        (defaults as any)[key] = raw[key];
      }
    }
    return defaults;
  }

  /**
   * Parse structured skills by domain
   */
  private static parseStructuredSkills(raw: Record<string, any>): StructuredSkills {
    const skills: StructuredSkills = {};
    if (!raw || typeof raw !== 'object') return skills;
    // Parse backend skills
    if (raw.backend) {
      skills.backend = {
        architecture: raw.backend.architecture || [],
        frameworks: this.extractTiers(raw.backend.frameworks),
        api: this.extractTiers(raw.backend.api),
        database: this.extractTiers(raw.backend.database),
        authentication_authorization: raw.backend['Authentication/Authorization'] ||
                                      raw.backend.authentication_authorization || [],
        security: raw.backend.security || [],
      };
    }
    // Parse frontend skills
    if (raw.frontend) {
      skills.frontend = {
        frameworks: this.extractTiers(raw.frontend.frameworks),
        comfort: raw.frontend.comfort || [],
      };
    }
    // Parse devops skills
    if (raw.devops) {
      skills.devops = {
        containerization: this.extractTiers(raw.devops.containerization),
        ci_cd: raw.devops.ci_cd || [],
        cloud: this.extractTiers(raw.devops.cloud),
      };
    }
    // Parse other skills
    skills.tooling = raw.tooling || [];
    skills.methodologies = raw.methodologies || [];
    skills.soft_skills = raw.soft_skills || [];
    return skills;
  }

  /**
   * Extract skill tiers from nested object
   */
  private static extractTiers(obj: any): Record<SkillTier, string[]> {
    const defaults: Record<SkillTier, string[]> = {
      solid: [],
      working: [],
      familiar: [],
    };
    if (!obj || typeof obj !== 'object') return defaults;
    return {
      solid: obj.solid || [],
      working: obj.working || [],
      familiar: obj.familiar || [],
    };
  }

  /**
   * Extract flat normalized skills for matching
   */
  private static extractNormalizedSkills(
    fundamentals: SoftwareFundamentals,
    skills: StructuredSkills,
    projects: any[]
  ): NormalizedSkill[] {
    const normalized: NormalizedSkill[] = [];
    // Extract from programming languages
    for (const [tier, langs] of Object.entries(fundamentals.programming_language)) {
      for (const lang of langs) {
        normalized.push({
          name: lang,
          tier: tier as SkillTier,
          evidence: ['work'], // Assume work evidence for fundamentals
          domains: ['backend', 'fundamentals'],
        });
      }
    }
    // Extract from backend skills
    if (skills.backend) {
      this.addSkillsFromTiered(
        skills.backend.frameworks,
        'backend',
        ['work'],
        normalized
      );
      this.addSkillsFromTiered(
        skills.backend.api,
        'backend',
        ['work'],
        normalized
      );
      this.addSkillsFromTiered(
        skills.backend.database,
        'database',
        ['work'],
        normalized
      );
    }
    // Extract from frontend skills
    if (skills.frontend?.frameworks) {
      this.addSkillsFromTiered(
        skills.frontend.frameworks,
        'frontend',
        ['work'],
        normalized
      );
    }
    // Extract from devops skills
    if (skills.devops) {
      if (skills.devops.containerization) {
        this.addSkillsFromTiered(
          skills.devops.containerization,
          'devops',
          ['lab'],
          normalized
        );
      }
      if (skills.devops.cloud) {
        this.addSkillsFromTiered(
          skills.devops.cloud,
          'devops',
          ['work'],
          normalized
        );
      }
    }
    // Extract from tooling
    if (skills.tooling) {
      for (const tool of skills.tooling) {
        normalized.push({
          name: tool,
          tier: 'working',
          evidence: ['work'],
          domains: ['tooling'],
        });
      }
    }
    return normalized;
  }

  /**
   * Add skills from tiered structure
   */
  private static addSkillsFromTiered(
    tiered: Record<SkillTier, string[]> | undefined,
    domain: string,
    evidence: EvidenceType[],
    target: NormalizedSkill[]
  ): void {
    if (!tiered) return;
    for (const [tier, skillList] of Object.entries(tiered)) {
      for (const skill of skillList) {
        target.push({
          name: skill,
          tier: tier as SkillTier,
          evidence,
          domains: [domain],
        });
      }
    }
  }

  /**
   * Basic email validation
   */
  private static isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}

/**
 * Immutable profile snapshot loader
 * 
 * Loads profile from file and caches the normalized version
 * with hash verification for immutability guarantee.
 */
export class ProfileSnapshotLoader {
  private static cachedProfile: ProfileNormalized | null = null;
  private static cachedHash: string | null = null;

  /**
   * Load profile snapshot with caching and hash verification
   */
  static load(filePath: string): ProfileNormalized {
    const currentHash = this.calculateFileHash(filePath);

    // Return cached if hash matches
    if (this.cachedProfile && this.cachedHash === currentHash) {
      return this.cachedProfile;
    }

    // Parse and cache
    const profile = ProfileParser.loadFromFile(filePath);
    this.cachedProfile = profile;
    this.cachedHash = currentHash;

    return profile;
  }

  /**
   * Clear cache (for testing)
   */
  static clearCache(): void {
    this.cachedProfile = null;
    this.cachedHash = null;
  }

  /**
   * Get cached profile hash
   */
  static getCachedHash(): string | null {
    return this.cachedHash;
  }

  /**
   * Calculate SHA256 hash of file
   */
  private static calculateFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
