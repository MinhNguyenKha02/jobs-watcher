/**
 * Job Constraints & Filtering Module
 * Normalizes parsed job data against profile and filters incompatible jobs
 * Rules: Position normalization, location mapping, experience level validation
 */
import fs from 'fs';
import path from 'path';
import type { ParsedEmail, Profile } from '../types.js';

let cachedProfile: Profile | null = null;

export function loadProfile(): Profile {
  if (cachedProfile) return cachedProfile;
  const filePath = path.resolve(process.cwd(), 'resources', 'profile.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  cachedProfile = JSON.parse(raw) as Profile;
  return cachedProfile;
}

function removeDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toKey(s: string): string {
  return removeDiacritics(s).toLowerCase().trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CITY_SYNONYMS: Record<string, string[]> = {
  'ho-chi-minh': [
    'hcmc',
    'ho chi minh',
    'ho chi minh city',
    'tp.hcm',
    'thanh pho ho chi minh',
    'tp hcm',
  ],
  'hanoi': [
    'hanoi',
    'ha noi',
    'hà noi',
    'thanh pho ha noi',
  ],
  'da-nang': [
    'da nang',
    'dà nang',
    'danang',
    'tp da nang',
  ],
};

function normalizeCityKey(input?: string): string | null {
  if (!input) return null;
  const norm = toKey(input);
  for (const [key, list] of Object.entries(CITY_SYNONYMS)) {
    for (const syn of list) {
      if (norm.includes(syn)) return key;
    }
  }
  return null;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function buildAllowedPositions(profile: Profile): string[] {
  const positions = [profile.title, ...profile.experience.map(e => e.position)].filter(Boolean) as string[];
  return unique(positions.map(p => p.trim())).filter(p => p.length > 0);
}

function normalizeRoleSynonyms(s: string): string {
  return s.replace(/developer/gi, 'engineer').replace(/devops/gi, 'devops');
}

function tokenizePosition(s: string): string[] {
  const stop = new Set(['senior', 'jr', 'junior', 'mid', 'middle', 'lead', 'principal', 'staff', 'intern', 'i', 'ii', 'iii']);
  const norm = normalizeRoleSynonyms(toKey(s));
  return norm.split(/[^a-z0-9]+/).filter(t => t && !stop.has(t));
}

function matchesAllowedPosition(pos: string, allowed: string[]): boolean {
  const posTokens = new Set(tokenizePosition(pos));
  return allowed.some(a => {
    const aTokens = new Set(tokenizePosition(a));
    for (const t of posTokens) {
      if (aTokens.has(t)) return true;
    }
    const p = normalizeRoleSynonyms(toKey(pos));
    const ak = normalizeRoleSynonyms(toKey(a));
    return p.includes(ak) || ak.includes(p);
  });
}

function buildAllowedLocations(profile: Profile): string[] {
  const locations = [profile.location, ...profile.experience.map(e => e.location)].filter(Boolean) as string[];
  return unique(locations.map(l => l.trim())).filter(l => l.length > 0);
}

// Profile experience helper (profile-side seniority; not used in job filtering logic)
function calculateExperienceLevel(profile: Profile): string {
  let totalMonths = 0;
  for (const exp of profile.experience) {
    const start = new Date(`${exp.startDate}-01`);
    const end = exp.endDate === 'Present' ? new Date() : new Date(`${exp.endDate}-01`);
    totalMonths += Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30));
  }
  const years = totalMonths / 12;
  if (years < 1.5) return 'junior';
  if (years < 4) return 'mid';
  return 'senior';
}

/**
 * Detect experience level required by job from description
 * Ultra-junior focus (< 1.5 yrs): reject any mid/senior or year requirements
 * Returns: 'junior' (entry-level OK) or null (reject)
 */
export function detectJobExperienceLevel(description: string, position: string): 'junior' | null {
  const fullText = `${position || ''} ${description || ''}`.toLowerCase();

  const seniorPatterns = [/\b(principal|staff|architect|lead|senior)\b/i];
  if (seniorPatterns.some(p => p.test(fullText))) return null;

  const midPatterns = [/\bmid(?:dle)?(?:-|\s)?level\b/i, /\bintermediate\b/i];
  if (midPatterns.some(p => p.test(fullText))) return null;

  const yearsPatterns = [
    /\b\d+(?:\.\d+)?\s*(?:\+|plus)?\s*(?:years?|yrs?)\b/i,
    /\b\d+\s*-\s*\d+\s*(?:years?|yrs?)\b/i,
    /\b(?:at\s+least|min(?:imum)?)\s+\d+(?:\.\d+)?\s*(?:years?|yrs?)\b/i,
    /\b\d+(?:\.\d+)?\s*(?:years?|yrs?)\s+of\s+experience\b/i,
    /\bexperience\s+of\s+\d+(?:\.\d+)?\s*(?:years?|yrs?)\b/i,
  ];
  if (yearsPatterns.some(p => p.test(fullText))) return null;

  const juniorPatterns = [/\bjunior\b/i, /\bentry[-\s]?level\b/i, /\bfresher\b/i, /\bfresh\s+graduate\b/i, /\bgraduate\b/i, /\bintern\b/i, /\bbeginner\b/i];
  if (juniorPatterns.some(p => p.test(fullText))) return 'junior';

  // Default: assume junior-friendly if no blockers detected
  return 'junior';
}

export function normalizeParsedEmail(input: ParsedEmail): { parsed: ParsedEmail; warnings: string[] } {
  const profile = loadProfile();
  const warnings: string[] = [];
  const parsed: ParsedEmail = { ...input };

  // Position normalization
  if (parsed.position) {
    const allowedPositions = buildAllowedPositions(profile);
    if (!matchesAllowedPosition(parsed.position, allowedPositions)) {
      parsed.position = profile.title;
      warnings.push('Position normalized to profile title');
    }
  } else {
    parsed.position = profile.title;
    warnings.push('Position normalized to profile title');
  }

  // Location normalization
  const allowedLocations = buildAllowedLocations(profile);
  const profileCityKey = normalizeCityKey(profile.location || '');
  const parsedOriginalLocation = parsed.location?.trim();
  const parsedCityKey = normalizeCityKey(parsed.location);

  if (!parsedOriginalLocation) {
    parsed.location = profile.location;
    warnings.push('Location set to profile default');
  } else if (parsedCityKey) {
    const candidates = allowedLocations.filter(l => normalizeCityKey(l) === parsedCityKey);
    let chosen = candidates[0];
    if (profileCityKey && profileCityKey === parsedCityKey && candidates.includes(profile.location)) {
      chosen = profile.location;
    }
    if (chosen && chosen.trim() !== parsedOriginalLocation) {
      parsed.location = chosen;
      warnings.push('Location normalized to canonical city');
    }
  } else {
    if (parsedOriginalLocation !== profile.location) {
      parsed.location = profile.location;
      warnings.push('Location normalized to profile default');
    }
  }

  return { parsed, warnings };
}

// --- Junior-focused rule-based filtering ---
const NON_SOFTWARE_ROLE_KEYWORDS = [
  'hr',
  'human resources',
  'recruiter',
  'talent acquisition',
  'office manager',
  'administrative',
  'accounting',
  'accountant',
  'sales',
  'marketing',
  'customer service',
  'support agent',
  'designer',
  'ui/ux designer',
  'graphic designer',
  'qa tester',
  'manual tester',
];

// Base tech concepts when profile skills are unavailable; skewed to TS/Go and general software
const DEFAULT_TECH_KEYWORDS = [
  'typescript',
  'ts',
  'javascript',
  'go',
  'golang',
  'rest api',
  'graphql',
  'docker',
  'kubernetes',
  'linux',
  'git',
  'sql',
  'postgresql',
  'mongodb',
  'redis',
];

/**
 * Normalize skill name for case-insensitive, flexible matching
 */
function normalizeSkill(skill: string): string {
  return skill.toLowerCase().trim();
}

/**
 * Check if a skill from job matches any profile skill (case-insensitive, substring matching)
 */
function skillMatchesProfile(jobSkill: string, profileSkills: string[]): boolean {
  const target = normalizeSkill(jobSkill);
  return profileSkills.some(ps => {
    const profileSkill = normalizeSkill(ps);
    return profileSkill.includes(target) || target.includes(profileSkill);
  });
}

/**
 * Extract technical skills/keywords from job description and position using profile-aligned keywords
 */
function extractJobSkills(position: string, description: string, profile: Profile): string[] {
  const text = `${position} ${description}`.toLowerCase();
  const keywords = (profile.skills?.length ? profile.skills : DEFAULT_TECH_KEYWORDS).map(k => normalizeSkill(k));

  const found: string[] = [];
  for (const kw of keywords) {
    if (!kw) continue;
    const pattern = new RegExp(escapeRegExp(kw).replace(/\s+/g, '\\s*'), 'i');
    const match = text.match(pattern);
    if (match) {
      found.push(match[0]);
    }
  }
  return [...new Set(found)];
}

/**
 * Filter job based on profile compatibility
 * Returns: { passes: boolean; reason?: string; matchedSkills?: string[] }
 */
export function filterJobCompatibility(
  job: ParsedEmail,
  profile: Profile = loadProfile()
): { passes: boolean; reason?: string; matchedSkills?: string[] } {
  // 1) Reject non-software roles (match whole keywords in position/description)
  const roleText = `${job.position || ''} ${job.description || ''}`;
  const nonSoftwarePatterns = NON_SOFTWARE_ROLE_KEYWORDS.map(k =>
    new RegExp(`\\b${escapeRegExp(k).replace(/\\s+/g, '\\s+')}\\b`, 'i')
  );
  if (nonSoftwarePatterns.some(p => p.test(roleText))) {
    return { passes: false, reason: 'Non-software role' };
  }

  // 2) Check experience level: must return 'junior' (accept) or null (reject)
  const expLevel = detectJobExperienceLevel(job.description || '', job.position || '');
  if (expLevel !== 'junior') {
    // detectJobExperienceLevel returns null for mid/senior/any years requirement
    return { passes: false, reason: 'Requires experience beyond junior level' };
  }

  // 3) Skills relevance (non-blocking): collect overlaps using flexible matching
  const extracted = extractJobSkills(job.position || '', job.description || '', profile);
  const matchedSkills = extracted.filter(skill => skillMatchesProfile(skill, profile.skills || []));

  // Skills are advisory only (no scoring, no blocking); favor junior opportunity
  return {
    passes: true,
    matchedSkills,
  };
}

export const _internal = {
  normalizeCityKey,
  matchesAllowedPosition,
  calculateExperienceLevel,
};
