import fs from 'node:fs';
import path from 'node:path';
import Handlebars from 'handlebars';
import type { ApplicationAsset } from '../../../domain/types/profile-normalized.js';
import { config } from '../../../config.js';
import { mergeGroups, techStackToArray } from './tech-stack.utils.js';

Handlebars.registerHelper('join', (items: string[], separator: string) =>
  items.join(separator)
);

export interface AtsTemplateContext {
  name: string;
  contact: {
    email: string;
    phone: string;
    location: string;
    linkedin?: string;
    github?: string;
  };
  skillGroups: { label: string; skills: string[] }[];
  experience: { company: string; role: string; startDate: string; endDate: string; responsibilities: string[]; outcomes: string[] }[];
  education: { institution: string; degree: string; field: string; startDate?: string; endDate?: string; grade?: string }[];
  projects: { title: string; position: string; startDate: string; endDate: string; techStack: string[]; keyContributions: string[]; outcomes: string[]; evidences: { key: string; items: { alias: string; url: string }[] }[] }[];
  meta: { jobId: string; company: string; role: string; date: string };
}

export function buildContext(asset: ApplicationAsset): AtsTemplateContext {
  const skillGroups = mergeGroups(asset.skillGroups || []);

  const experience = (asset.experience || []).map((exp) => ({
    company: exp.company || '',
    role: exp.title || '',
    startDate: exp.startDate || '',
    endDate: exp.endDate || 'Present',
    responsibilities: (exp as any).responsibilities || [],
    outcomes: (exp as any).outcomes || [],
  }));

  const education = (asset.education || []).map((edu) => ({
    institution: edu.school || '',
    degree: edu.degree || '',
    field: edu.field || '',
    startDate: (edu as any).startDate || undefined,
    endDate: edu.year || undefined,
    grade: (edu as any).grade || undefined,
  }));

  const projects = (asset.projects || []).map((proj) => ({
    title: proj.title || '',
    position: (proj as any).position || '',
    startDate: (proj as any).startDate || '',
    endDate: (proj as any).endDate || 'Present',
    techStack: techStackToArray((proj as any).techStack),
    keyContributions: (proj as any).responsibilities || [],
    outcomes: (proj as any).outcomes || [],
    evidences: (proj as any).evidences || [],
  }));

  return {
    name: [asset.firstName, asset.lastName].filter(Boolean).join(' ') || 'Unknown',
    contact: {
      email: asset.email || '',
      phone: asset.phone || '',
      location: asset.location || '',
      linkedin: asset.linkedin || undefined,
      github: asset.github || undefined,
    },
    skillGroups,
    experience,
    education,
    projects,
    meta: {
      jobId: asset.jobId,
      company: asset.company,
      role: asset.jobTitle,
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
    },
  };
}

export function renderAts(
  asset: ApplicationAsset,
  outputDir: string,
  templatePath?: string
): string {
  const tmplPath = templatePath || path.join(config.templatesPath, 'md-pattern.hbs');
  const template = fs.readFileSync(tmplPath, 'utf-8');
  const compiled = Handlebars.compile(template);
  const context = buildContext(asset);
  const output = compiled(context);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'ats-resume.md');
  fs.writeFileSync(outputPath, output, 'utf-8');
  return outputPath;
}
