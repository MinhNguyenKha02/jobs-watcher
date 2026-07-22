export class SkillKeyNormalizer {
  static normalizeSkillName(key: string): string {
    return key
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  static mapCategoryToLabel(category: string): string {
    const map: Record<string, string> = {
      backend: 'Backend',
      architecture: 'Architecture',
      observability: 'Observability',
      infrastructure: 'Infrastructure',
      security: 'Security',
      communication: 'Communication',
      foundation: 'Fundamentals',
      testing: 'Testing',
      language: 'Languages',
      backend_framework: 'Backend',
      frontend_framework: 'Frontend',
      protocol: 'Protocols',
      database: 'Databases',
      third_party: 'Third Party',
    };
    return map[category] ?? SkillKeyNormalizer.normalizeSkillName(category);
  }

  static getCategoryOrder(): string[] {
    return [
      'Backend',
      'Languages',
      'Databases',
      'Infrastructure',
      'Protocols',
      'Testing',
      'Frontend',
      'Third Party',
      'Architecture',
      'Observability',
      'Security',
      'Fundamentals',
      'Communication',
    ];
  }
}
