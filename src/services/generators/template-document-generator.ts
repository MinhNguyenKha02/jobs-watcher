/**
 * Template Document Generator (Sprint 3A.3)
 * Renders ApplicationDraft into PDF/DOCX artifacts.
 */

import fs from 'fs';
import path from 'path';
import { config } from '../../config.js';
import type { ApplicationDraft } from '../../types/profile-normalized.js';
import { TemplateRenderer, TemplateType } from '../templates/index.js';
import { PdfGenerator } from './pdf-generator.js';
import { DocxGenerator } from './docx-generator.js';

export type DocumentFormat = 'pdf' | 'docx';

export interface GenerateOptions {
  outputDir?: string;
  templateTypes?: TemplateType[];
  formats?: DocumentFormat[];
}

export interface GeneratedArtifacts {
  outputDir: string;
  files: string[];
}

export class TemplateDocumentGenerator {
  constructor(private baseOutputDir: string = config.generatedPath) {}

  async generateForDraft(draft: ApplicationDraft, options: GenerateOptions = {}): Promise<GeneratedArtifacts> {
    const jobId = draft.jobId || 'unknown';
    const outputDir = options.outputDir || path.join(this.baseOutputDir, this.sanitize(jobId));

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const templateTypes = options.templateTypes || [TemplateType.CV, TemplateType.COVER_LETTER];
    const formats = options.formats || ['pdf', 'docx'];
    const files: string[] = [];

    for (const templateType of templateTypes) {
      const rendered = templateType === TemplateType.CV
        ? TemplateRenderer.renderCV(draft)
        : TemplateRenderer.renderCoverLetter(draft);

      const baseName = templateType === TemplateType.CV ? 'cv' : 'cover-letter';

      for (const format of formats) {
        const outputPath = path.join(outputDir, `${baseName}.${format}`);
        if (format === 'pdf') {
          await PdfGenerator.generateFromText(rendered.content, outputPath);
        } else {
          await DocxGenerator.generateFromText(rendered.content, outputPath);
        }
        files.push(outputPath);
      }
    }

    return { outputDir, files };
  }

  private sanitize(input: string): string {
    return input.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }
}
