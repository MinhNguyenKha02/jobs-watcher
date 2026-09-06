// src/services/profile/resume/compiler/ats-skill-group.mapper.ts

import { AnchorNode } from '../../types/retrieval.types.js';

/**
 * Maps anchor categories to ATS skill group labels.
 * This mapping is used to group skills into recruiter-friendly sections.
 */
export class AtsSkillGroupMapper {
  /**
   * Maps an anchor category to a group label.
   *
   * @param category The category of the anchor (e.g., 'backend', 'database')
   * @returns The group label (e.g., 'Backend', 'Databases')
   */
  static mapCategoryToGroupLabel(category: string): string {
    // Normalize the category to lowercase for comparison
    const normalizedCategory = category.toLowerCase();

    // Strict 6-label mapping (Q1: frontend→Frontend 6th, third_party hidden elsewhere)
    const categoryToGroupMap: Record<string, string> = {
      // 1) Languages
      language: 'Languages',
      // 2) Backend hub (cap+tech collapsed)
      backend: 'Backend',
      backend_framework: 'Backend',
      protocol: 'Backend',
      security: 'Backend',
      communication: 'Backend',
      // 3) Frontend (6th label, separate from Backend)
      frontend_framework: 'Frontend',
      // 4) Databases
      database: 'Databases',
      // 5) Infrastructure (observability collapsed)
      infrastructure: 'Infrastructure',
      observability: 'Infrastructure',
      // 6) Testing
      testing: 'Testing',
      // Note: architecture/foundation dropped (no label); third_party is hidden in compiler (not mapped)
      // comp/beh not in primary; handled separately.
    };

    // third_party ad-hoc anchors (Gmail API, Whisper.cpp) are hidden — return empty sentinel
    if (normalizedCategory === 'third_party') return '';
    return categoryToGroupMap[normalizedCategory] || '';
  }

  /**
   * Determines whether a given anchor kind should be in the primary or secondary section.
   *
   * @param kind The kind of the anchor (cap, comp, beh, tech)
   * @returns 'primary' or 'secondary'
   */
  static getSectionKind(kind: 'cap' | 'comp' | 'beh' | 'tech'): 'primary' | 'secondary' {
    // Based on the visibility policy:
    //   tech -> primary
    //   cap, comp, beh -> hidden (not included in the ATS skill section at all)
    return kind === 'tech' ? 'primary' : 'secondary';
  }
}
