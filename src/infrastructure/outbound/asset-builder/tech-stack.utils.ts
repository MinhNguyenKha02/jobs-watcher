import { SkillKeyNormalizer } from '../../../domain/profile/resume/normalization/skill-key-normalizer.js';

export const CATEGORY_REMAP: Record<string, string> = {
  Backend: 'Backend',
  Architecture: 'Backend',
  Security: 'Backend',
  Communication: 'Backend',
  Fundamentals: 'Backend',
  Frameworks: 'Backend',
  Protocols: 'Backend',
  Languages: 'Languages',
  Databases: 'Databases',
  Infrastructure: 'Infrastructure',
  Testing: 'Testing',
  Observability: 'Observability',
};

export function mergeGroups(groups: { label: string; skills: string[] }[]): { label: string; skills: string[] }[] {
  const merged = new Map<string, Set<string>>();
  for (const group of groups) {
    const target = CATEGORY_REMAP[group.label];
    if (!target) continue;
    if (!merged.has(target)) merged.set(target, new Set());
    for (const skill of group.skills) {
      merged.get(target)!.add(skill);
    }
  }
  return Array.from(merged.entries())
    .map(([label, skills]) => ({ label, skills: Array.from(skills) }))
    .sort((a, b) => {
      const order = SkillKeyNormalizer.getCategoryOrder();
      return order.indexOf(a.label) - order.indexOf(b.label);
    });
}

export function techStackToArray(techStack: Record<string, string[]> | undefined): string[] {
  if (!techStack) return [];
  const merged = new Map<string, Set<string>>();
  for (const [category, skills] of Object.entries(techStack)) {
    const label = SkillKeyNormalizer.mapCategoryToLabel(category);
    const target = CATEGORY_REMAP[label];
    if (!target) continue;
    if (!merged.has(target)) merged.set(target, new Set());
    for (const s of skills) merged.get(target)!.add(SkillKeyNormalizer.normalizeSkillName(s));
  }
  const order = SkillKeyNormalizer.getCategoryOrder();
  const result: string[] = [];
  for (const cat of order) {
    const skills = merged.get(cat);
    if (skills) result.push(...skills);
  }
  return result;
}
