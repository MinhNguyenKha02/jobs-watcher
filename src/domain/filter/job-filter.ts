/**
 * Hybrid Job Filter Service
 * - Strict on position/title/experience (profile match)
 * - Relaxed on structural fields (description, company, platform, etc.)
 * - Logs all filter reasons and missing/ambiguous fields
 */

import type { Job } from '../types/job.js';

import { matchesRole, matchesLang, matchesExperience, JobFilterResult } from './constraints.js';

export interface FilterOptions {
  sinceTier?: 2;
}

export function hybridJobFilter(job: Partial<Job>, options?: FilterOptions): JobFilterResult {
  const sinceTier = options?.sinceTier ?? 1;

  if (sinceTier === 1) {
    const t1 = matchesRole(job.role);
    if (!t1.passed) return { passed: false, reasons: t1.reasons || [] };

    return { passed: true, reasons: [] };
  }
  const t2 = matchesLang(job.details, job.description);
  if (!t2.passed) return { passed: false, reasons: t2.reasons || [] };
  const t4 = matchesExperience(job.details, job.description);
  if (!t4.passed) return { passed: false, reasons: t4.reasons || [] };

  return { passed: true, reasons: [] };
}
