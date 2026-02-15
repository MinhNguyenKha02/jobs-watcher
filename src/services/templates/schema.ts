/**
 * Template Schema Definitions
 * 
 * Defines the structure of CV and cover letter templates with sections,
 * placeholders, and rendering options.
 */

/**
 * Enum for template types
 */
export enum TemplateType {
  CV = 'cv',
  COVER_LETTER = 'cover-letter',
}

/**
 * Enum for section visibility
 */
export enum SectionVisibility {
  ALWAYS = 'always',
  IF_DATA = 'if-data',
  OPTIONAL = 'optional',
}

/**
 * Template section configuration
 */
export interface TemplateSection {
  id: string;
  title: string;
  placeholder: string;
  visibility: SectionVisibility;
  order: number;
  description?: string;
}

/**
 * CV-specific sections
 */
export const CV_SECTIONS: TemplateSection[] = [
  {
    id: 'header',
    title: 'Header (Name, Contact)',
    placeholder: '{{firstName}} {{lastName}} | {{email}} | {{phone}} | {{location}}',
    visibility: SectionVisibility.ALWAYS,
    order: 1,
  },
  {
    id: 'summary',
    title: 'Professional Summary',
    placeholder: '{{summary}}',
    visibility: SectionVisibility.IF_DATA,
    order: 2,
  },
  {
    id: 'skills',
    title: 'Technical Skills',
    placeholder: '{{matchedSkills}}',
    visibility: SectionVisibility.IF_DATA,
    order: 3,
  },
  {
    id: 'experience',
    title: 'Professional Experience',
    placeholder: '{{experience}}',
    visibility: SectionVisibility.ALWAYS,
    order: 4,
  },
  {
    id: 'education',
    title: 'Education',
    placeholder: '{{education}}',
    visibility: SectionVisibility.IF_DATA,
    order: 5,
  },
  {
    id: 'projects',
    title: 'Key Projects',
    placeholder: '{{projects}}',
    visibility: SectionVisibility.OPTIONAL,
    order: 6,
  },
  {
    id: 'certifications',
    title: 'Certifications',
    placeholder: '{{certifications}}',
    visibility: SectionVisibility.OPTIONAL,
    order: 7,
  },
];

/**
 * Cover letter sections
 */
export const COVER_LETTER_SECTIONS: TemplateSection[] = [
  {
    id: 'header',
    title: 'Header (Date, Hiring Manager)',
    placeholder: '{{date}}\n{{hireManagerName}}\n{{companyName}}\n{{companyAddress}}',
    visibility: SectionVisibility.ALWAYS,
    order: 1,
  },
  {
    id: 'greeting',
    title: 'Greeting',
    placeholder: 'Dear {{hireManagerName}},',
    visibility: SectionVisibility.ALWAYS,
    order: 2,
  },
  {
    id: 'opening',
    title: 'Opening Paragraph',
    placeholder: '{{openingParagraph}}',
    visibility: SectionVisibility.IF_DATA,
    order: 3,
  },
  {
    id: 'body',
    title: 'Body (Fit, Skills, Examples)',
    placeholder: '{{bodyParagraph}}',
    visibility: SectionVisibility.ALWAYS,
    order: 4,
  },
  {
    id: 'closing',
    title: 'Closing Paragraph',
    placeholder: '{{closingParagraph}}',
    visibility: SectionVisibility.IF_DATA,
    order: 5,
  },
  {
    id: 'signature',
    title: 'Signature',
    placeholder: 'Best regards,\n{{firstName}} {{lastName}}\n{{phone}}\n{{email}}',
    visibility: SectionVisibility.ALWAYS,
    order: 6,
  },
];

/**
 * Get sections for a template type
 */
export function getSections(type: TemplateType): TemplateSection[] {
  switch (type) {
    case TemplateType.CV:
      return CV_SECTIONS;
    case TemplateType.COVER_LETTER:
      return COVER_LETTER_SECTIONS;
    default:
      return [];
  }
}

/**
 * Template configuration
 */
export interface TemplateConfig {
  type: TemplateType;
  name: string;
  description?: string;
  sections: TemplateSection[];
  hiddenSections?: string[]; // IDs of sections to hide
  showOptional?: string[]; // IDs of optional sections to show
}

/**
 * Create a default template config
 */
export function createDefaultTemplateConfig(type: TemplateType): TemplateConfig {
  return {
    type,
    name: `Default ${type.toUpperCase()}`,
    sections: getSections(type),
    hiddenSections: [],
    showOptional: [],
  };
}

/**
 * Get visible sections based on config and data availability
 */
export function getVisibleSections(
  config: TemplateConfig,
  dataAvailability: Record<string, boolean>
): TemplateSection[] {
  return config.sections
    .filter(section => {
      // Never show hidden sections
      if (config.hiddenSections?.includes(section.id)) {
        return false;
      }

      // Always show ALWAYS visibility sections
      if (section.visibility === SectionVisibility.ALWAYS) {
        return true;
      }

      // Show IF_DATA sections if data is available
      if (section.visibility === SectionVisibility.IF_DATA) {
        return dataAvailability[section.id] === true;
      }

      // Show OPTIONAL sections only if explicitly requested
      if (section.visibility === SectionVisibility.OPTIONAL) {
        return config.showOptional?.includes(section.id) === true;
      }

      return false;
    })
    .sort((a, b) => a.order - b.order);
}
