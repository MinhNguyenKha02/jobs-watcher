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

    // Define the mapping from category to group label
    const categoryToGroupMap: Record<string, string> = {
      // Capabilities (cap)
      backend: 'Backend',
      architecture: 'Architecture',
      observability: 'Observability',
      infrastructure: 'Infrastructure',
      security: 'Security',
      communication: 'Communication',
      foundation: 'Fundamentals',
      testing: 'Testing',
      // Technology (tech)
      language: 'Languages',
      backend_framework: 'Frameworks',
      frontend_framework: 'Frameworks',
      protocol: 'Protocols',
      database: 'Databases',
      // Note: We don't have a direct mapping for comp and beh because they are not in the primary section.
      // However, we will handle comp and beh separately in the compiler.
    };

    return categoryToGroupMap[normalizedCategory] || normalizedCategory;
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
