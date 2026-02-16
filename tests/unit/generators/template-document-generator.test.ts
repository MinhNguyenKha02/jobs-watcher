import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ApplicationDraft } from '../../../src/types/profile-normalized.js';
import { TemplateDocumentGenerator } from '../../../src/services/generators/template-document-generator.js';
import { TemplateType } from '../../../src/services/templates/index.js';

describe('TemplateDocumentGenerator', () => {
  it('generates DOCX artifacts for a draft', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-watcher-artifacts-'));
    const generator = new TemplateDocumentGenerator(tempDir);

    const draft = {
      jobId: 'job-001',
      jobTitle: 'Software Engineer',
      company: 'Example Co',
      sections: [],
      matchedSkills: ['TypeScript'],
      skillGaps: [],
      relevanceScore: 0.9,
      evidenceMappings: [],
      draftedAt: new Date().toISOString(),
      profileHash: 'hash',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      summary: 'Summary',
    } as ApplicationDraft;

    const result = await generator.generateForDraft(draft, {
      formats: ['docx'],
      templateTypes: [TemplateType.CV],
      outputDir: path.join(tempDir, 'job-001'),
    });

    expect(result.files.length).toBe(1);
    expect(result.files[0].endsWith('cv.docx')).toBe(true);
    expect(fs.existsSync(result.files[0])).toBe(true);
  });
});
