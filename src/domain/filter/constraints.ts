/**
 * Job Constraints & Filtering Module
 * Normalizes parsed job data against profile and filters incompatible jobs
 * Rules: Position normalization, location mapping, experience level validation
 */

import type { JobDetails } from '../types/job.js';

export interface JobFilterResult {
  passed: boolean;
  reasons: string[];
}

function removeDiacritics(s: string): string {
  return s.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function toKey(s: string): string {
  return removeDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim();
}

type DetailsObject = Record<string, unknown> | JobDetails;

function extractDetailsText(
  details: DetailsObject | undefined | null,
  description?: string
): string {
  const parts: string[] = [];
  if (details) {
    for (const val of Object.values(details)) {
      if (typeof val === 'string') parts.push(val);
      if (typeof val === 'object' && val !== null) {
        for (const v of Object.values(val as Record<string, unknown>)) {
          if (typeof v === 'string') parts.push(v);
        }
      }
    }
  }
  if (description) parts.push(description);
  return parts.join(' ');
}

function normalizeText(
  input: string | DetailsObject | undefined | null,
  description?: string
): string {
  if (typeof input === 'string') return toKey(input);
  return toKey(extractDetailsText(input, description));
}

// --- Tier 2: Language patterns (EN + VI) ---
const LANG_PATTERNS: RegExp[] = [
  // JavaScript / TypeScript
  /\bjavascript\b/,
  /\btypescript\b/,
  /\bnode(?:\.js|js)?\b/,
  
  // Python
  /\bpython(?:3)?\b/,

  // Go
  /\b(?:go|golang)\b/,

];

// --- Tier 1: Role patterns (EN + VI) ---
const ROLE_PATTERNS: RegExp[] = [
// Software
  /\bsoftware(?:\s+application)?\s+(?:engineer|developer)\b/,
  /\b(?:ky su|lap trinh vien)\s+phan mem\b/,

    // Backend
  /\bbackend(?:\s+software)?\s+(?:engineer|developer)\b/,
  /\b(?:ky su|lap trinh vien)\s+backend\b/,


  // Full Stack
  /\bfull[- ]?stack(?:\s+software)?\s+(?:engineer|developer)\b/,
  /\b(?:ky su|lap trinh vien)\s+full[- ]?stack\b/,

    // Web
  /\bweb\s+developer\b/,
  /\blap trinh vien\s+web\b/,

  // Data
  /\bdata\s+engineer\b/,
  /\bky su\s+du lieu\b/,

  // Automation
  /\bautomation\s+(?:engineer|developer)\b/,
  /\b(?:ky su|lap trinh vien)\s+automation\b/,

  // ERP
  /\berp\s+(?:engineer|developer)\b/,
  /\blap trinh vien\s+erp\b/,

];

export function matchesRole(
  input: string | DetailsObject | undefined | null,
  description?: string
): JobFilterResult {
  if (!input) return { passed: false, reasons: ['No role information'] };
  const text = normalizeText(input, description)

  for (const pattern of ROLE_PATTERNS) {
    if (pattern.test(text)) return { passed: true, reasons: [] };
  }
  return { passed: false, reasons: ['non-software role'] };
}

export function matchesLang(input: string | DetailsObject | undefined | null, description?: string): JobFilterResult {
  
  if (!input) return { passed: false, reasons: ['No language information'] };
  const text = normalizeText(input, description);
  
  for (const pattern of LANG_PATTERNS) {
    if (pattern.test(text)) return { passed: true, reasons: [] };
  }
  return { passed: false, reasons: ['No matching language'] };
}

const EXPERIENCE_REJECT_PATTERNS = [
  // Numeric
  /\b(?:[3-9]|[1-9]\d)\+?\s*(?:years?|yrs?)\b/,
  /\b(?:[3-9]|[1-9]\d)\s*(?:years?|yrs?)\s+of\s+experience\b/,

  /\b2\s*[-–]\s*4\s*(?:years?|yrs?)\b/,
  /\b3\s*[-–]\s*5\s*(?:years?|yrs?)\b/,
  /\b4\s*[-–]\s*6\s*(?:years?|yrs?)\b/,

  /\b2\s+to\s+4\s*(?:years?|yrs?)\b/,
  /\b3\s+to\s+5\s*(?:years?|yrs?)\b/,

  // Seniority
  /\bmid[- ]level\b/,
  /\bmiddle[- ]level\b/,

  /\bsenior\s+(?:software\s+)?engineer\b/,
  /\bsenior\s+(?:software\s+)?developer\b/,
  /\bsenior\s+backend\b/,
  /\bsenior\s+frontend\b/,
  /\bsenior\s+full[- ]?stack\b/,

  /\bteam\s+lead\b/,
  /\btech\s+lead\b/,
  /\btechnical\s+lead\b/,
  /\blead\s+engineer\b/,
  /\blead\s+developer\b/,

  /\bstaff\s+engineer\b/,
  /\bprincipal\s+engineer\b/,
  /\bsolution\s+architect\b/,

  // Vietnamese
  /\btren\s*2\s*nam\b/,
  /\btren\s*3\s*nam\b/,
  /\btoi thieu\s*3\s*nam\b/,
  /\bit nhat\s*3\s*nam\b/,
  /\byeu cau\s*3\s*nam\b/,

  /\bkinh nghiem tu\s*3\s*nam\b/,
  /\bkinh nghiem tu\s*4\s*nam\b/,

  /\bchuyen vien cao cap\b/,
  /\btruong nhom\b/,
];

export function matchesExperience(input: string | DetailsObject | undefined | null, description?: string): JobFilterResult {
  if (!input) return { passed: false, reasons: ['No experience information']};
  const text = normalizeText(input, description);
  for (const rejectPattern of EXPERIENCE_REJECT_PATTERNS) {
    if (rejectPattern.test(text)) return { passed: false, reasons: ['Not matching experience level'] };
  }
  return { passed: true, reasons: [] };
}