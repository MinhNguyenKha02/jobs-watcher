import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { ApplicationAsset } from '../../../domain/types/profile-normalized.js';
import { config } from '../../../config.js';

export interface CoverLetterContext {
  name: string;
  contact: { email: string; phone: string; location: string };
  meta: { company: string; role: string; date: string };
}

function buildContext(asset: ApplicationAsset): CoverLetterContext {
  return {
    name: [asset.firstName, asset.lastName].filter(Boolean).join(' ') || 'Unknown',
    contact: {
      email: asset.email || '',
      phone: asset.phone || '',
      location: asset.location || '',
    },
    meta: {
      company: asset.company,
      role: asset.jobTitle,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    },
  };
}

export function renderCoverLetter(
  asset: ApplicationAsset,
  outputDir: string,
  templatePath?: string
): string {
  const tmplPath = templatePath || path.join(config.templatesPath, 'cover-letter-pattern.hbs');
  const template = fs.readFileSync(tmplPath, 'utf-8');
  const compiled = Handlebars.compile(template);
  const context = buildContext(asset);
  const output = compiled(context);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'cover-letter.md');
  fs.writeFileSync(outputPath, output, 'utf-8');
  return outputPath;
}
