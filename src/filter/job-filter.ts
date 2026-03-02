/**
 * Hybrid Job Filter Service
 * - Strict on position/title/experience (profile match)
 * - Relaxed on structural fields (description, company, platform, etc.)
 * - Logs all filter reasons and missing/ambiguous fields
 */
import { PLATFORM_NAMES } from '../constants.js';
import type { Job, Profile } from '../types.js';
import { filterJobCompatibility } from './constraints.js';

export interface JobFilterResult {
  passed: boolean;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  matchedProfile: boolean;
  hardReject: boolean;
  strictFields: Record<string, unknown>;
  relaxedFields: Record<string, unknown>;
}

function getBlockedPlatforms(): Set<string> {
  const raw = process.env.BLOCKED_JOB_PLATFORMS || process.env.JOB_BLOCKED_PLATFORMS || '';
  return new Set(
    raw
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function hybridJobFilter(job: Partial<Job>, profile: Profile): JobFilterResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const strictFields: Record<string, unknown> = {};
  const relaxedFields: Record<string, unknown> = {};
  const blockedPlatforms = getBlockedPlatforms();

  // Strict: Use filterJobCompatibility for robust junior/software filtering
  const compat = filterJobCompatibility(job as any, profile);
  let matchedProfile = false;
  if (!compat.passed) {
    if (compat.reasons) reasons.push(...compat.reasons);
  } else {
    matchedProfile = true;
  }
  strictFields.title = job.position || (job as any).title || '';
  strictFields.experienceLevel = (job as any).experienceLevel || '';

  // Relaxed: description, company, platform, skills
  if (!job.description) missingFields.push('description');
  if (!job.company) missingFields.push('company');
  const platform = job.platform || (typeof (job as any).source === 'string' ? (job as any).source : undefined);
  if (!platform) missingFields.push('platform');
  
  // Skills can be extracted from description, so don't mark as missing if description exists
  const skills = (job as any).skills || (job as any).requiredSkills;
  if (!skills && !job.description) {
    missingFields.push('skills');
  }
  if (missingFields.length > 0) {
    warnings.push(...missingFields.map((field) => `missing_${field}`));
  }

  relaxedFields.description = job.description;
  relaxedFields.company = job.company;
  relaxedFields.platform = platform;
  relaxedFields.skills = skills;

  // Platform detection (relaxed) - case-insensitive
  const platformLower = job.platform?.toLowerCase() || '';
  const normalizedPlatforms = PLATFORM_NAMES.map(p => p.toLowerCase());
  
  if (job.platform && !normalizedPlatforms.includes(platformLower)) {
    warnings.push('unknown_platform');
  } else if (typeof (job as any).source === 'string') {
    const sourceLower = ((job as any).source as string).toLowerCase();
    if (!normalizedPlatforms.includes(sourceLower)) {
      warnings.push('unknown_platform');
    }
  }

  const platformNormalized = (typeof platform === 'string' ? platform : '').toLowerCase();
  if (platformNormalized && blockedPlatforms.has(platformNormalized)) {
    reasons.push(`Blocked platform: ${platform}`);
  }

  // Final pass/fail
  const hardReject = reasons.some(
    (reason) =>
      /non-software role/i.test(reason) ||
      /blocked platform/i.test(reason)
  );
  const passed = matchedProfile && !hardReject;
  return {
    passed,
    reasons,
    warnings: [...new Set(warnings)],
    missingFields,
    matchedProfile,
    hardReject,
    strictFields,
    relaxedFields,
  };
}
