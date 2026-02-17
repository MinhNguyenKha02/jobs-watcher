/**
 * Score Matcher Engine
 *
 * Calculates job match score using:
 * - Range-based (salary/location bands)
 * - Ordered (skill priority)
 * - Weighted probabilities (0.5 skills, 0.3 salary, 0.2 location)
 *
 * Algorithm (safe, incremental):
 * 1. Extract user core skills (ordered by priority)
 * 2. Search job description for skills (ordered match)
 * 3. Calculate salary match (range probability)
 * 4. Calculate location match (fuzzy + excluded check)
 * 5. Weighted sum → final score (0-100)
 *
 * Fallbacks for missing data:
 * - Missing skills → neutral (0.5)
 * - Missing salary → neutral (0.5)
 * - Missing location → neutral (0.5)
 */

import type { Job, Profile } from '../../types.js';
import { getLogger } from '../logger.js';

const logger = getLogger();

/**
 * Scoring configuration (weights sum to 1.0)
 */
export interface ScoringConfig {
  weights: {
    skillsMatch: number; // 0.5
    salaryMatch: number; // 0.3
    locationMatch: number; // 0.2
  };
  skillMatchThreshold: number; // 0.3 (30% of skills must match)
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  weights: {
    skillsMatch: 0.5,
    salaryMatch: 0.3,
    locationMatch: 0.2,
  },
  skillMatchThreshold: 0.3,
};

/**
 * Score breakdown for transparency
 */
export interface ScoreBreakdown {
  skillsScore: number; // 0-100
  salaryScore: number; // 0-100
  locationScore: number; // 0-100
  finalScore: number; // 0-100
  reasoning: string;
  details: {
    userSkills: string[];
    jobSkillsFound: string[];
    userSalaryRange: { min: number; max: number } | null;
    jobSalary: string | null;
    userLocations: string[];
    jobLocation: string | null;
  };
}

/**
 * Extract user core skills from profile (ordered by priority)
 */
function extractUserSkills(profile: Profile | null): string[] {
  if (!profile) return [];

  // Try multiple profile property names for robustness
  const skillsRaw =
    (typeof profile.skills === 'string' || Array.isArray(profile.skills)
      ? profile.skills
      : undefined) ||
    (typeof (profile as any).profile_skills === 'string' ||
    Array.isArray((profile as any).profile_skills)
      ? (profile as any).profile_skills
      : undefined) ||
    (typeof (profile as any).coreSkills === 'string' || Array.isArray((profile as any).coreSkills)
      ? (profile as any).coreSkills
      : undefined);

  if (!skillsRaw) return [];

  const skillsArray = Array.isArray(skillsRaw)
    ? skillsRaw
    : typeof skillsRaw === 'string'
      ? skillsRaw.split(',').map((s) => s.trim())
      : [];

  return skillsArray.filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 10); // Top 10 skills
}

/**
 * Extract salary range from profile (normalized)
 */
function extractSalaryRange(profile: Profile | null): { min: number; max: number } | null {
  if (!profile) return null;

  const minSalary =
    typeof (profile as any).minSalary === 'number' ? (profile as any).minSalary : undefined;
  const maxSalary =
    typeof (profile as any).maxSalary === 'number' ? (profile as any).maxSalary : undefined;

  if (typeof minSalary === 'number' && typeof maxSalary === 'number') {
    return { min: minSalary, max: maxSalary };
  }

  return null;
}

/**
 * Extract preferred locations from profile
 */
function extractUserLocations(profile: Profile | null): string[] {
  if (!profile) return [];

  const locationsRaw =
    (typeof (profile as any).preferred_locations === 'string' ||
    Array.isArray((profile as any).preferred_locations)
      ? (profile as any).preferred_locations
      : undefined) ||
    (typeof (profile as any).location === 'string' || Array.isArray((profile as any).location)
      ? (profile as any).location
      : undefined);

  if (!locationsRaw) return [];

  const locArray = Array.isArray(locationsRaw)
    ? locationsRaw
    : typeof locationsRaw === 'string'
      ? locationsRaw.split(',').map((s) => s.trim())
      : [];

  return locArray.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Calculate skills match score (0-100)
 * Ordered matching: look for user skills in job description (case-insensitive)
 */
function calculateSkillsScore(
  userSkills: string[],
  job: Job,
  config: ScoringConfig
): { score: number; matched: string[] } {
  if (userSkills.length === 0) {
    // Neutral: no skills to match
    return { score: 50, matched: [] };
  }

  const jobDescription =
    `${job.position || ''} ${job.company || ''} ${job.description || ''} ${JSON.stringify(job.details || {})}`.toLowerCase();

  const matched: string[] = [];

  for (const skill of userSkills) {
    // Exact match + word boundary
    const regex = new RegExp(`\\b${skill.toLowerCase()}\\b`, 'gi');
    if (regex.test(jobDescription)) {
      matched.push(skill);
    }
  }

  const matchRatio = matched.length / userSkills.length;

  // Check if meets threshold
  if (matchRatio < config.skillMatchThreshold) {
    return { score: Math.round(matchRatio * 100 * 0.8), matched }; // Penalize below threshold
  }

  // Linear scale 30% → 100% matched = 50 → 100 score
  const score = 50 + (matchRatio - 0.3) * (50 / 0.7);
  return { score: Math.round(Math.min(100, Math.max(50, score))), matched };
}

/**
 * Calculate salary match score (0-100)
 * Range-based probability:
 * - In range: 1.0 (100)
 * - Below range: 0.5 (50) - may negotiate up
 * - Above range: 0.2 (20) - likely too expensive
 * - No data: 0.5 (50) - neutral
 */
function calculateSalaryScore(
  userSalaryRange: { min: number; max: number } | null,
  job: Job
): number {
  if (!userSalaryRange) {
    return 50; // Neutral: no user range specified
  }

  if (!job.salary) {
    return 50; // Neutral: no job salary specified
  }

  // Try to parse job salary (e.g., "$80,000 - $120,000", "80k-120k")
  const salaryStr = job.salary.toLowerCase().replace(/[$,k]/g, '');
  const salaryMatch = salaryStr.match(/(\d+)\s*[-–]\s*(\d+)/);

  if (!salaryMatch) {
    return 50; // Neutral: couldn't parse
  }

  // Normalize to thousands (handle "120" vs "120000")
  let jobMin = parseInt(salaryMatch[1], 10);
  let jobMax = parseInt(salaryMatch[2], 10);

  if (jobMin < 1000) jobMin *= 1000;
  if (jobMax < 1000) jobMax *= 1000;

  const jobMid = (jobMin + jobMax) / 2;

  // Range probability:
  // - In range [user.min, user.max]: 100
  // - Below range: scale 0-50 (0 at user.min - 50k, 50 at user.min)
  // - Above range: scale 20-50 (50 at user.max, 20 at user.max + 50k)

  if (jobMid >= userSalaryRange.min && jobMid <= userSalaryRange.max) {
    return 100;
  } else if (jobMid < userSalaryRange.min) {
    // Scale from 0 at (min - 50k) to 50 at min
    const offset = userSalaryRange.min - jobMid;
    return Math.max(0, 50 - (offset / 50000) * 50);
  } else {
    // Scale from 50 at max to 20 at (max + 50k)
    const offset = jobMid - userSalaryRange.max;
    return Math.max(20, 50 - (offset / 50000) * 30);
  }
}

/**
 * Calculate location match score (0-100)
 * Ordered + fuzzy matching:
 * - Exact match or "Remote": 100
 * - City match (fuzzy): 80
 * - State/country match: 60
 * - Not in excluded list but unmatched: 40
 * - Excluded list: 0
 */
function calculateLocationScore(userLocations: string[], jobLocation: string | null): number {
  if (!jobLocation || userLocations.length === 0) {
    return 50; // Neutral
  }

  const jobLocLower = jobLocation.toLowerCase();

  // Check excluded locations first
  const excludedLocations = userLocations.filter((loc) => loc.startsWith('!'));
  for (const excluded of excludedLocations) {
    const excludedName = excluded.substring(1).toLowerCase();
    if (jobLocLower.includes(excludedName)) {
      return 0; // Hard exclude
    }
  }

  // Check preferred locations (ordered by priority)
  const preferredLocations = userLocations.filter((loc) => !loc.startsWith('!'));

  // Exact match or "Remote"
  if (
    jobLocLower === 'remote' ||
    preferredLocations.some((loc) => jobLocLower === loc.toLowerCase())
  ) {
    return 100;
  }

  // Fuzzy match (substring match, city level)
  if (preferredLocations.some((loc) => jobLocLower.includes(loc.toLowerCase()))) {
    return 80;
  }

  // Unmatched but not excluded
  return 40;
}

/**
 * Main scoring function (safe, with fallbacks)
 */
export function calculateJobScore(
  job: Job | null,
  profile: Profile | null,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): ScoreBreakdown {
  const userSkills = extractUserSkills(profile);
  const userSalaryRange = extractSalaryRange(profile);
  const userLocations = extractUserLocations(profile);

  // Safe defaults for null/missing job
  if (!job) {
    return {
      skillsScore: 50,
      salaryScore: 50,
      locationScore: 50,
      finalScore: 50,
      reasoning: 'No job provided (neutral score)',
      details: {
        userSkills,
        jobSkillsFound: [],
        userSalaryRange,
        jobSalary: null,
        userLocations,
        jobLocation: null,
      },
    };
  }

  // Calculate component scores
  const { score: skillsScore, matched: jobSkillsFound } = calculateSkillsScore(
    userSkills,
    job,
    config
  );
  const salaryScore = calculateSalaryScore(userSalaryRange, job);
  const locationScore = calculateLocationScore(userLocations, job.location || null);

  // Weighted sum
  const finalScore = Math.round(
    skillsScore * config.weights.skillsMatch +
      salaryScore * config.weights.salaryMatch +
      locationScore * config.weights.locationMatch
  );

  // Reasoning
  const reasoning = [
    `Skills: ${jobSkillsFound.length}/${userSkills.length} matched (${skillsScore}/100)`,
    `Salary: ${salaryScore}/100`,
    `Location: ${locationScore}/100`,
  ].join(' | ');

  logger.debug('Score calculated', {
    job: job.company,
    position: job.position,
    finalScore,
    breakdown: { skillsScore, salaryScore, locationScore },
  });

  return {
    skillsScore,
    salaryScore,
    locationScore,
    finalScore,
    reasoning,
    details: {
      userSkills,
      jobSkillsFound,
      userSalaryRange,
      jobSalary: job.salary || null,
      userLocations,
      jobLocation: job.location || null,
    },
  };
}
