/**
 * Template Renderer Snapshot Tests
 * 
 * Verifies that rendered templates are consistent and deterministic.
 */

import { TemplateRenderer, TemplateType, createDefaultTemplateConfig } from '../../src/services/templates/index.js';
import type { ApplicationDraft } from '../../src/types/profile-normalized.js';

describe('TemplateRenderer', () => {
  const sampleDraft: ApplicationDraft = {
    jobId: 'job-001',
    jobTitle: 'Senior TypeScript Developer',
    company: 'TechCorp Inc',
    sections: [],
    matchedSkills: ['TypeScript', 'Node.js', 'React', 'PostgreSQL'],
    skillGaps: [],
    relevanceScore: 0.85,
    profileHash: 'abc123',
    timestamp: new Date('2026-02-15'),
    
    // Profile info for rendering
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    phone: '+1 (555) 123-4567',
    location: 'San Francisco, CA',
    title: 'Software Engineer',
    summary: 'Experienced full-stack developer with 5+ years in TypeScript and cloud technologies.',
    
    // Experience
    experience: [
      {
        title: 'Senior Engineer',
        company: 'Previous Corp',
        startDate: '2023-01',
        endDate: '2026-02',
        description: 'Led development of microservices architecture using Node.js and TypeScript.',
      },
    ],
    
    // Education
    education: [
      {
        degree: 'B.S.',
        field: 'Computer Science',
        school: 'State University',
        year: 2018,
      },
    ],
    
    // Projects
    projects: [
      {
        title: 'Job Alert System',
        description: 'Built real-time job alert system using Node.js, React, and PostgreSQL.',
      },
    ],
    
    // Cover letter fields
    hireManagerName: 'Jane Smith',
    companyAddress: '123 Tech Street, San Francisco, CA 94102',
    openingParagraph: 'I am thrilled to apply for the Senior TypeScript Developer role at TechCorp Inc.',
    bodyParagraph: 'My expertise in TypeScript, Node.js, and React directly aligns with your requirements. I have successfully delivered several high-impact projects...',
    closingParagraph: 'Thank you for your consideration. I look forward to discussing this opportunity.',
  };

  describe('CV Rendering', () => {
    it('should render a complete CV snapshot', () => {
      const config = createDefaultTemplateConfig(TemplateType.CV);
      const rendered = TemplateRenderer.renderCV(sampleDraft, config);

      expect(rendered.type).toBe(TemplateType.CV);
      expect(rendered.sectionOrder).toContain('header');
      expect(rendered.sectionOrder).toContain('experience');
      expect(rendered.content).toContain('John Doe');
      expect(rendered.content).toContain('Senior Engineer');
      expect(rendered.content).toMatchSnapshot('cv-full');
    });

    it('should maintain deterministic section order', () => {
      const config = createDefaultTemplateConfig(TemplateType.CV);
      const rendered1 = TemplateRenderer.renderCV(sampleDraft, config);
      const rendered2 = TemplateRenderer.renderCV(sampleDraft, config);

      expect(rendered1.sectionOrder).toEqual(rendered2.sectionOrder);
      expect(rendered1.content).toBe(rendered2.content);
    });

    it('should hide optional sections not explicitly shown', () => {
      const config = createDefaultTemplateConfig(TemplateType.CV);
      const rendered = TemplateRenderer.renderCV(sampleDraft, config);

      // Projects and certifications are optional by default
      expect(rendered.sectionOrder).not.toContain('certifications');
    });

    it('should show optional sections when explicitly requested', () => {
      const config = createDefaultTemplateConfig(TemplateType.CV);
      config.showOptional = ['projects', 'certifications'];
      const rendered = TemplateRenderer.renderCV(sampleDraft, config);

      expect(rendered.sectionOrder).toContain('projects');
      expect(rendered.content).toContain('Job Alert System');
    });

    it('should hide sections when requested', () => {
      const config = createDefaultTemplateConfig(TemplateType.CV);
      config.hiddenSections = ['education'];
      const rendered = TemplateRenderer.renderCV(sampleDraft, config);

      expect(rendered.sectionOrder).not.toContain('education');
      expect(rendered.content).not.toContain('B.S.');
    });

    it('should handle missing optional data gracefully', () => {
      const minimalDraft: ApplicationDraft = {
        jobId: 'job-002',
        jobTitle: 'Developer',
        company: 'Company',
        sections: [],
        matchedSkills: [],
        skillGaps: [],
        relevanceScore: 0.5,
        profileHash: 'def456',
        timestamp: new Date(),
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
      };

      const config = createDefaultTemplateConfig(TemplateType.CV);
      const rendered = TemplateRenderer.renderCV(minimalDraft, config);

      expect(rendered.type).toBe(TemplateType.CV);
      expect(rendered.content).toContain('Jane Smith');
      expect(rendered.content).not.toContain('undefined');
    });
  });

  describe('Cover Letter Rendering', () => {
    it('should render a complete cover letter snapshot', () => {
      const config = createDefaultTemplateConfig(TemplateType.COVER_LETTER);
      const rendered = TemplateRenderer.renderCoverLetter(sampleDraft, config);

      expect(rendered.type).toBe(TemplateType.COVER_LETTER);
      expect(rendered.sectionOrder).toContain('header');
      expect(rendered.sectionOrder).toContain('greeting');
      expect(rendered.content).toContain('Jane Smith');
      expect(rendered.content).toContain('TechCorp Inc');
      expect(rendered.content).toMatchSnapshot('cover-letter-full');
    });

    it('should maintain deterministic structure', () => {
      const config = createDefaultTemplateConfig(TemplateType.COVER_LETTER);
      const rendered1 = TemplateRenderer.renderCoverLetter(sampleDraft, config);
      const rendered2 = TemplateRenderer.renderCoverLetter(sampleDraft, config);

      expect(rendered1.sectionOrder).toEqual(rendered2.sectionOrder);
      expect(rendered1.content).toBe(rendered2.content);
    });

    it('should generate body from matched skills if not provided', () => {
      const draftWithoutBody = { ...sampleDraft };
      delete draftWithoutBody.bodyParagraph;

      const config = createDefaultTemplateConfig(TemplateType.COVER_LETTER);
      const rendered = TemplateRenderer.renderCoverLetter(draftWithoutBody, config);

      expect(rendered.content).toContain('TypeScript');
      expect(rendered.content).toContain('TechCorp Inc');
    });

    it('should include matched skills in cover letter body', () => {
      const config = createDefaultTemplateConfig(TemplateType.COVER_LETTER);
      const rendered = TemplateRenderer.renderCoverLetter(sampleDraft, config);

      // Should use provided bodyParagraph
      expect(rendered.content).toContain('Node.js');
    });
  });

  describe('Snapshot Integrity', () => {
    it('should produce consistent CV across multiple renders', () => {
      const config = createDefaultTemplateConfig(TemplateType.CV);
      const renders = Array.from({ length: 5 }, () =>
        TemplateRenderer.renderCV(sampleDraft, config).content
      );

      const firstRender = renders[0];
      renders.forEach(render => {
        expect(render).toBe(firstRender);
      });
    });

    it('should produce consistent cover letter across multiple renders', () => {
      const config = createDefaultTemplateConfig(TemplateType.COVER_LETTER);
      const renders = Array.from({ length: 5 }, () =>
        TemplateRenderer.renderCoverLetter(sampleDraft, config).content
      );

      const firstRender = renders[0];
      renders.forEach(render => {
        expect(render).toBe(firstRender);
      });
    });
  });
});
