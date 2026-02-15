/**
 * Template Service Index
 * Exports all template-related types and utilities
 */

// Schema exports
export {
  TemplateType,
  SectionVisibility,
  type TemplateSection,
  CV_SECTIONS,
  COVER_LETTER_SECTIONS,
  getSections,
  type TemplateConfig,
  createDefaultTemplateConfig,
  getVisibleSections,
} from './schema.js';

// Renderer exports
export {
  TemplateRenderer,
  type RenderedTemplate,
} from './renderer.js';
