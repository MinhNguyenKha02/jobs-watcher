/**
 * Normalized Profile Types for Application Customizer (Phase 3A.1)
 *
 * Based on canonical profile format (json.json) with strict typing
 * and validation support for deterministic draft generation.
 */

/**
 * Skill tier representing technical competency level
 */
export type SkillTier = 'solid' | 'working' | 'familiar';

/**
 * Evidence type for skill claims
 */
export type EvidenceType = 'work' | 'lab' | 'thesis';

/**
 * Normalized skill with tier and evidence
 */
export interface NormalizedSkill {
  name: string;
  tier: SkillTier;
  evidence: EvidenceType[];
  domains: string[]; // e.g., ['backend', 'database']
}

/**
 * Software fundamentals categories
 */
export interface SoftwareFundamentals {
  programming_language: Record<SkillTier, string[]>;
  dsa: string[];
  os: string[];
  oop: string[];
  database: string[];
  networking: string[];
  security: string[];
  test: string[];
  ai: string[];
}

/**
 * Structured skills by domain with tiers
 */
export interface StructuredSkills {
  backend?: {
    architecture?: string[];
    frameworks?: Record<SkillTier, string[]>;
    api?: Record<SkillTier, string[]>;
    database?: Record<SkillTier, string[]>;
    authentication_authorization?: string[];
    security?: string[];
  };
  frontend?: {
    frameworks?: Record<SkillTier, string[]>;
    comfort?: string[];
  };
  devops?: {
    containerization?: Record<SkillTier, string[]>;
    ci_cd?: string[];
    cloud?: Record<SkillTier, string[]>;
  };
  tooling?: string[];
  methodologies?: string[];
  soft_skills?: string[];
}

/**
 * Project with evidence
 */
export interface ProjectEvidence {
  name: string;
  period: string;
  summary: string;
  tech: string[];
  status?: 'active' | 'paused' | 'completed';
}

/**
 * Work experience entry
 */
export interface WorkExperience {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string[]; // Array of bullet points
}

/**
 * Education entry
 */
export interface EducationEntry {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

/**
 * Normalized Profile - Single Source of Truth
 *
 * This is the validated, normalized representation of the canonical
 * profile (json.json) used for deterministic draft generation.
 */
export interface ProfileNormalized {
  // Identity
  name: string;
  email: string;
  phone: string;
  location: string;
  title: string;
  summary: string[];

  // Skills (normalized with tiers and evidence)
  fundamentals: SoftwareFundamentals;
  skills: StructuredSkills;
  normalizedSkills: NormalizedSkill[]; // Flat list for matching

  // Evidence
  projects: ProjectEvidence[];
  experience: WorkExperience[];
  education: EducationEntry[];

  // Links
  links: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    website?: string;
  };

  // Metadata
  profileHash?: string; // SHA256 hash of canonical profile
  normalizedAt?: string; // ISO timestamp
}

/**
 * Profile validation result
 */
export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Draft section types
 */
export type DraftSectionType = 'summary' | 'skills' | 'experience' | 'projects' | 'education';

/**
 * Draft section with content
 */
export interface DraftSection {
  type: DraftSectionType;
  title: string;
  content: string;
  priority: number; // Lower number = higher priority
  relevance: number; // 0-1 score based on job match
}

/**
 * Job-specific application draft
 */
export interface ApplicationDraft {
  jobId: string;
  jobTitle: string;
  company: string;

  // Ordered sections based on job fit
  sections: DraftSection[];

  // Matching metadata
  matchedSkills: string[];
  skillGaps: string[];
  relevanceScore: number;

  // Evidence trail
  evidenceMappings: {
    skill: string;
    tier: SkillTier;
    evidence: string[]; // Project/experience references
  }[];

  // Metadata
  draftedAt: string;
  profileHash: string;

  // Optional fields for template rendering
  summary?: string;
  experience?: Array<{
    title?: string;
    company?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    [key: string]: any;
  }>;
  education?: Array<{
    degree?: string;
    field?: string;
    school?: string;
    year?: string;
    [key: string]: any;
  }>;
  projects?: Array<{
    title?: string;
    description?: string;
    [key: string]: any;
  }>;
  certifications?: Array<{
    name?: string;
    year?: string;
    [key: string]: any;
  }>;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  hireManagerName?: string;
  openingParagraph?: string;
  bodyParagraph?: string;
  closingParagraph?: string;
  companyAddress?: string;
}

export type ApplicationAsset = ApplicationDraft;
