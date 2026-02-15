/**
 * Template Renderer Service
 * 
 * Renders ApplicationDraft into ATS-friendly text/markdown using templates.
 * Supports section show/hide and deterministic formatting.
 */

import type { Job } from '../../types.js';
import type { ApplicationDraft } from '../../types/profile-normalized.js';
import { TemplateType, TemplateConfig, getVisibleSections, createDefaultTemplateConfig } from './schema.js';

/**
 * Rendered template output
 */
export interface RenderedTemplate {
  type: TemplateType;
  content: string;
  sectionOrder: string[];
  generatedAt: Date;
}

/**
 * Template renderer
 */
export class TemplateRenderer {
  /**
   * Render CV from draft
   */
  static renderCV(draft: ApplicationDraft, config?: TemplateConfig): RenderedTemplate {
    const templateConfig = config || createDefaultTemplateConfig(TemplateType.CV);

    // Determine which sections have data
    const dataAvailability = {
      header: true,
      summary: Boolean(draft.summary),
      skills: Boolean(draft.matchedSkills?.length),
      experience: Boolean(draft.experience?.length),
      education: Boolean(draft.education?.length),
      projects: Boolean(draft.projects?.length),
      certifications: Boolean(draft.certifications?.length),
    };

    const visibleSections = getVisibleSections(templateConfig, dataAvailability);
    const sectionOrder = visibleSections.map(s => s.id);

    // Render sections in order
    const sections: string[] = [];

    for (const section of visibleSections) {
      const rendered = TemplateRenderer.renderCVSection(section.id, draft);
      if (rendered) {
        sections.push(rendered);
      }
    }

    return {
      type: TemplateType.CV,
      content: sections.join('\n\n'),
      sectionOrder,
      generatedAt: new Date(),
    };
  }

  /**
   * Render cover letter from draft
   */
  static renderCoverLetter(draft: ApplicationDraft, config?: TemplateConfig): RenderedTemplate {
    const templateConfig = config || createDefaultTemplateConfig(TemplateType.COVER_LETTER);

    const dataAvailability = {
      header: true,
      greeting: true,
      opening: Boolean(draft.openingParagraph),
      body: true,
      closing: Boolean(draft.closingParagraph),
      signature: true,
    };

    const visibleSections = getVisibleSections(templateConfig, dataAvailability);
    const sectionOrder = visibleSections.map(s => s.id);

    const sections: string[] = [];

    for (const section of visibleSections) {
      const rendered = TemplateRenderer.renderCoverLetterSection(section.id, draft);
      if (rendered) {
        sections.push(rendered);
      }
    }

    return {
      type: TemplateType.COVER_LETTER,
      content: sections.join('\n\n'),
      sectionOrder,
      generatedAt: new Date(),
    };
  }

  /**
   * Render individual CV section
   */
  private static renderCVSection(sectionId: string, draft: ApplicationDraft): string | null {
    switch (sectionId) {
      case 'header':
        return TemplateRenderer.renderCVHeader(draft);

      case 'summary':
        return draft.summary
          ? `## Professional Summary\n\n${draft.summary}`
          : null;

      case 'skills':
        if (!draft.matchedSkills?.length) return null;
        const skillsList = draft.matchedSkills
          .map(skill => `- ${skill}`)
          .join('\n');
        return `## Technical Skills\n\n${skillsList}`;

      case 'experience':
        if (!draft.experience?.length) return null;
        const expItems = draft.experience
          .map(exp => `### ${exp.title} at ${exp.company}\n${exp.startDate} - ${exp.endDate || 'Present'}\n\n${exp.description || ''}`)
          .join('\n\n');
        return `## Professional Experience\n\n${expItems}`;

      case 'education':
        if (!draft.education?.length) return null;
        const eduItems = draft.education
          .map(edu => `### ${edu.degree} in ${edu.field}\n${edu.school}\n${edu.year}`)
          .join('\n\n');
        return `## Education\n\n${eduItems}`;

      case 'projects':
        if (!draft.projects?.length) return null;
        const projItems = draft.projects
          .map(proj => `### ${proj.title}\n${proj.description}`)
          .join('\n\n');
        return `## Key Projects\n\n${projItems}`;

      case 'certifications':
        if (!draft.certifications?.length) return null;
        const certItems = draft.certifications
          .map(cert => `- ${cert.name} (${cert.year})`)
          .join('\n');
        return `## Certifications\n\n${certItems}`;

      default:
        return null;
    }
  }

  /**
   * Render CV header
   */
  private static renderCVHeader(draft: ApplicationDraft): string {
    const lines: string[] = [];

    if (draft.firstName && draft.lastName) {
      lines.push(`# ${draft.firstName} ${draft.lastName}`);
    }

    const contact: string[] = [];
    if (draft.email) contact.push(draft.email);
    if (draft.phone) contact.push(draft.phone);
    if (draft.location) contact.push(draft.location);

    if (contact.length > 0) {
      lines.push(contact.join(' | '));
    }

    return lines.join('\n');
  }

  /**
   * Render individual cover letter section
   */
  private static renderCoverLetterSection(sectionId: string, draft: ApplicationDraft): string | null {
    switch (sectionId) {
      case 'header':
        return TemplateRenderer.renderCoverLetterHeader(draft);

      case 'greeting':
        return `Dear ${draft.hireManagerName || 'Hiring Manager'},`;

      case 'opening':
        return draft.openingParagraph
          ? draft.openingParagraph
          : `I am very interested in the ${draft.jobTitle} position at ${draft.company}. With my background in [relevant skills], I believe I am an excellent fit for your team.`;

      case 'body':
        return draft.bodyParagraph
          ? draft.bodyParagraph
          : TemplateRenderer.generateCoverLetterBody(draft);

      case 'closing':
        return draft.closingParagraph
          ? draft.closingParagraph
          : `Thank you for considering my application. I look forward to discussing how my skills and experience align with your needs.`;

      case 'signature':
        return TemplateRenderer.renderCoverLetterSignature(draft);

      default:
        return null;
    }
  }

  /**
   * Render cover letter header (date and recipient)
   */
  private static renderCoverLetterHeader(draft: ApplicationDraft): string {
    const lines: string[] = [];

    // Date
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    lines.push(dateStr);

    lines.push(''); // Blank line

    // Recipient address
    if (draft.hireManagerName) {
      lines.push(draft.hireManagerName);
    }
    if (draft.company) {
      lines.push(draft.company);
    }
    if (draft.companyAddress) {
      lines.push(draft.companyAddress);
    }

    return lines.join('\n');
  }

  /**
   * Generate cover letter body from matched skills
   */
  private static generateCoverLetterBody(draft: ApplicationDraft): string {
    if (!draft.matchedSkills?.length) {
      return `I am excited about the opportunity to join ${draft.company} as a ${draft.jobTitle}. My experience and skills make me a strong candidate for this role.`;
    }

    const skillsText = draft.matchedSkills.slice(0, 3).join(', ');
    return `My expertise in ${skillsText} directly aligns with the requirements for this role. I have successfully leveraged these skills in previous projects to deliver results that drive business value. I am confident I can bring the same impact to ${draft.company}.`;
  }

  /**
   * Render cover letter signature
   */
  private static renderCoverLetterSignature(draft: ApplicationDraft): string {
    const lines: string[] = [
      'Best regards,',
      '',
    ];

    if (draft.firstName && draft.lastName) {
      lines.push(`${draft.firstName} ${draft.lastName}`);
    }

    if (draft.phone) {
      lines.push(draft.phone);
    }

    if (draft.email) {
      lines.push(draft.email);
    }

    return lines.join('\n');
  }
}
