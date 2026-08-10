// src/services/profile/resume/normalization/canonical-skill.map.ts

/**
 * Canonical skill map for collapsing lexical aliases into canonical skill names.
 *
 * The map is from the normalized skill name (as produced by SkillNormalizer.normalizeAnchor)
 * to the canonical skill name that should be used in the ATS skill section.
 *
 * Example:
 *   'Rest Api' -> 'API Development'
 *   'Http Api' -> 'API Development'
 *   'Backend Api' -> 'API Development'
 */
export const canonicalSkillMap: Record<string, string> = {
  // Example cluster for API Development
  'Rest Api': 'API Development',
  'Http Api': 'API Development',
  'Backend Api': 'API Development',

  // Add more clusters as needed
  // For example, for Docker:
  // 'Docker': 'Containerization',
  // 'Container Engine': 'Containerization',

  // Note: We are using the normalized skill name format (as from SkillNormalizer).
  // That is, we convert kebab-case to title case (each word capitalized, spaces in between).
  // So the key 'rest-api' becomes 'Rest Api'.
};
