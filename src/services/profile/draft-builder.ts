/**
 * Draft Builder Service
 * 
 * Creates job-specific application drafts from ProfileNormalized and ScoredJob.
 * Implements evidence-based claims, skill ordering, and section prioritization.
 */

import type { Job } from '../../types.js';
import type {
  ProfileNormalized,
  ApplicationDraft,
  DraftSection,
  SkillTier,
} from '../../types/profile-normalized.js';

/**
 * Keyword extraction result
 */
interface KeywordExtractionResult {
  requiredSkills: string[];
  preferredSkills: string[];
  keyPhrases: string[];
}

/**
 * Skill match result
 */
interface SkillMatchResult {
  skill: string;
  tier: SkillTier;
  relevance: number;
  evidence: string[];
}

/**
 * Draft Builder for creating job-specific application drafts
 */
export class DraftBuilder {
  /**
   * Build draft from profile and job
   */
  static build(profile: ProfileNormalized, job: Job): ApplicationDraft {
    // Extract keywords from job
    const keywords = this.extractKeywords(job);

    // Match skills with job requirements
    const matchedSkills = this.matchSkills(profile, keywords);

    // Identify skill gaps
    const skillGaps = this.identifySkillGaps(keywords, matchedSkills);

    // Calculate relevance score
    const relevanceScore = this.calculateRelevance(
      keywords,
      matchedSkills.length
    );

    // Build sections with ordering based on job fit
    const sections = this.buildSections(
      profile,
      job,
      matchedSkills,
      keywords
    );

    // Create evidence mappings
    const evidenceMappings = matchedSkills.map(match => ({
      skill: match.skill,
      tier: match.tier,
      evidence: match.evidence,
    }));

    return {
      jobId: job.id || job.messageId || 'unknown',
      jobTitle: job.position,
      company: job.company,
      sections,
      matchedSkills: matchedSkills.map(m => m.skill),
      skillGaps,
      relevanceScore,
      evidenceMappings,
      draftedAt: new Date().toISOString(),
      profileHash: profile.profileHash || '',
    };
  }

  /**
   * Extract keywords from job description
   */
  private static extractKeywords(job: Job): KeywordExtractionResult {
    const text = [
      job.position,
      job.description || '',
      job.details?.requirements || '',
      job.details?.responsibilities || '',
    ].join(' ').toLowerCase();

    // Common technical skill patterns
    const skillPatterns = [
      'typescript', 'javascript', 'go', 'golang', 'python', 'java', 'c++', 'rust',
      'react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt',
      'node.js', 'express', 'nestjs', 'fastify',
      'postgresql', 'mongodb', 'redis', 'mysql',
      'docker', 'kubernetes', 'aws', 'azure', 'gcp',
      'rest', 'graphql', 'grpc', 'websocket',
      'git', 'ci/cd', 'testing', 'microservices',
      'laravel', 'gin', 'fiber', 'oauth', 'jwt',
    ];

    const requiredSkills: string[] = [];
    const preferredSkills: string[] = [];

    // Extract required skills (usually in "requirements" section)
    const requirements = (job.details?.requirements || '').toLowerCase();
    for (const skill of skillPatterns) {
      if (requirements.includes(skill)) {
        requiredSkills.push(skill);
      } else if (text.includes(skill)) {
        preferredSkills.push(skill);
      }
    }

    // Extract key phrases (3+ mentions)
    const phrases = text.match(/\b\w+\b/g) || [];
    const frequency = new Map<string, number>();
    for (const phrase of phrases) {
      if (phrase.length > 3) {
        frequency.set(phrase, (frequency.get(phrase) || 0) + 1);
      }
    }

    const keyPhrases = Array.from(frequency.entries())
      .filter(([_, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase]) => phrase);

    return {
      requiredSkills: Array.from(new Set(requiredSkills)),
      preferredSkills: Array.from(new Set(preferredSkills)),
      keyPhrases,
    };
  }

  /**
   * Match profile skills with job keywords
   */
  private static matchSkills(
    profile: ProfileNormalized,
    keywords: KeywordExtractionResult
  ): SkillMatchResult[] {
    const matches: SkillMatchResult[] = [];

    const allJobSkills = [
      ...keywords.requiredSkills,
      ...keywords.preferredSkills,
    ];

    function tokenizeSkill(skill: string): Set<string> {
      return new Set(skill.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean));
    }
    function tokenMatch(skillA: string, skillB: string): boolean {
      const tokensA = tokenizeSkill(skillA);
      const tokensB = tokenizeSkill(skillB);
      return [...tokensA].some(token => tokensB.has(token));
    }
    for (const profileSkill of profile.normalizedSkills) {
      const skillName = profileSkill.name.toLowerCase();
      // Token-based match
      const matchedKeywords = allJobSkills.filter(jobSkill =>
        tokenMatch(skillName, jobSkill)
      );
      if (matchedKeywords.length > 0) {
        const isRequired = keywords.requiredSkills.some(req =>
          tokenMatch(skillName, req)
        );
        const tierWeight = {
          solid: 1.0,
          working: 0.8,
          familiar: 0.6,
        }[profileSkill.tier];
        const relevance = (isRequired ? 1.0 : 0.7) * tierWeight;
        const evidence = this.findEvidence(
          profile,
          profileSkill.name,
          profileSkill.domains
        );
        matches.push({
          skill: profileSkill.name,
          tier: profileSkill.tier,
          relevance,
          evidence,
        });
      }
    }
    return matches.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Find evidence for a skill in projects and experience
   */
  private static findEvidence(
    profile: ProfileNormalized,
    skillName: string,
    domains: string[]
  ): string[] {
    const evidence: string[] = [];

    // Check projects
    for (const project of profile.projects) {
      const techMatch = project.tech.some((tech: string) =>
        tech.toLowerCase().includes(skillName.toLowerCase()) ||
        skillName.toLowerCase().includes(tech.toLowerCase())
      );

      if (techMatch) {
        evidence.push(`Project: ${project.name}`);
      }
    }

    // Check experience
    for (const exp of profile.experience) {
      const descMatch = exp.description.some(desc =>
        desc.toLowerCase().includes(skillName.toLowerCase())
      );

      if (descMatch) {
        evidence.push(`Experience: ${exp.company}`);
      }
    }

    return evidence.slice(0, 3); // Limit to 3 most relevant
  }

  /**
   * Identify skill gaps between job requirements and profile
   */
  private static identifySkillGaps(
    keywords: KeywordExtractionResult,
    matches: SkillMatchResult[]
  ): string[] {
    const matchedSkillNames = matches.map(m => m.skill.toLowerCase());
    
    const gaps = keywords.requiredSkills.filter(required => {
      return !matchedSkillNames.some(matched =>
        matched.includes(required) || required.includes(matched)
      );
    });

    return Array.from(new Set(gaps));
  }

  /**
   * Calculate overall relevance score
   */
  private static calculateRelevance(
    keywords: KeywordExtractionResult,
    matchCount: number
  ): number {
    const totalRequired = keywords.requiredSkills.length;
    const totalSkills = totalRequired + keywords.preferredSkills.length;

    if (totalSkills === 0) return 0.5; // Neutral if no skills detected

    // Weight required skills more heavily
    const requiredWeight = 0.7;
    const preferredWeight = 0.3;

    const score =
      (matchCount / totalRequired) * requiredWeight +
      (matchCount / totalSkills) * preferredWeight;

    return Math.min(Math.max(score, 0), 1);
  }

  /**
   * Build draft sections with ordering based on job fit
   */
  private static buildSections(
    profile: ProfileNormalized,
    job: Job,
    matches: SkillMatchResult[],
    keywords: KeywordExtractionResult
  ): DraftSection[] {
    const sections: DraftSection[] = [];

    // 1. Summary (always first)
    sections.push(this.buildSummarySection(profile, job, matches));

    // 2. Skills (high priority if many matches)
    sections.push(this.buildSkillsSection(profile, matches));

    // 3. Experience (prioritize if job is senior or mentions years)
    sections.push(this.buildExperienceSection(profile));

    // 4. Projects (prioritize if job is technical or mentions portfolio)
    sections.push(this.buildProjectsSection(profile, matches));

    // 5. Education (lowest priority for most jobs)
    sections.push(this.buildEducationSection(profile));

    // Sort by priority and relevance
    return sections.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.relevance - a.relevance;
    });
  }

  /**
   * Build summary section
   */
  private static buildSummarySection(
    profile: ProfileNormalized,
    job: Job,
    matches: SkillMatchResult[]
  ): DraftSection {
    const topSkills = matches.slice(0, 5).map(m => m.skill);
    
    const summaryWithSkills = [
      ...profile.summary,
      `\nKey skills matching ${job.company}: ${topSkills.join(', ')}`,
    ].join(' ');

    return {
      type: 'summary',
      title: 'Professional Summary',
      content: summaryWithSkills,
      priority: 1,
      relevance: 1.0,
    };
  }

  /**
   * Build skills section
   */
  private static buildSkillsSection(
    profile: ProfileNormalized,
    matches: SkillMatchResult[]
  ): DraftSection {
    const skillsByTier: Record<SkillTier, string[]> = {
      solid: [],
      working: [],
      familiar: [],
    };

    for (const match of matches) {
      skillsByTier[match.tier].push(match.skill);
    }

    const content = [
      skillsByTier.solid.length > 0 && `**Proficient:** ${skillsByTier.solid.join(', ')}`,
      skillsByTier.working.length > 0 && `**Working Knowledge:** ${skillsByTier.working.join(', ')}`,
      skillsByTier.familiar.length > 0 && `**Familiar:** ${skillsByTier.familiar.join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const relevance = matches.length > 5 ? 0.9 : 0.7;

    return {
      type: 'skills',
      title: 'Technical Skills',
      content,
      priority: 2,
      relevance,
    };
  }

  /**
   * Build experience section
   */
  private static buildExperienceSection(
    profile: ProfileNormalized
  ): DraftSection {
    const content = profile.experience
      .map(exp => {
        return [
          `**${exp.position}** at ${exp.company}`,
          `${exp.location} | ${exp.startDate} - ${exp.endDate}`,
          ...exp.description.map(desc => `- ${desc}`),
        ].join('\n');
      })
      .join('\n\n');

    return {
      type: 'experience',
      title: 'Work Experience',
      content,
      priority: 3,
      relevance: 0.8,
    };
  }

  /**
   * Build projects section
   */
  private static buildProjectsSection(
    profile: ProfileNormalized,
    matches: SkillMatchResult[]
  ): DraftSection {
    // Prioritize projects that use matched skills
    const matchedTech = new Set(matches.map(m => m.skill.toLowerCase()));

    const sortedProjects = [...profile.projects].sort((a, b) => {
      const aMatches = a.tech.filter((t: string) => matchedTech.has(t.toLowerCase())).length;
      const bMatches = b.tech.filter((t: string) => matchedTech.has(t.toLowerCase())).length;
      return bMatches - aMatches;
    });

    const content = sortedProjects
      .slice(0, 5) // Top 5 most relevant
      .map(project => {
        return [
          `**${project.name}** (${project.period})`,
          project.summary,
          `Tech: ${project.tech.join(', ')}`,
        ].join('\n');
      })
      .join('\n\n');

    return {
      type: 'projects',
      title: 'Key Projects',
      content,
      priority: 4,
      relevance: 0.75,
    };
  }

  /**
   * Build education section
   */
  private static buildEducationSection(
    profile: ProfileNormalized
  ): DraftSection {
    const content = profile.education
      .map(edu => {
        return [
          `**${edu.degree}** in ${edu.field}`,
          `${edu.institution} | ${edu.startDate} - ${edu.endDate}`,
          edu.gpa && `GPA: ${edu.gpa}`,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    return {
      type: 'education',
      title: 'Education',
      content,
      priority: 5,
      relevance: 0.5,
    };
  }
}
