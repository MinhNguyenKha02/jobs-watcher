import fs from 'node:fs';
import path from 'node:path';

import Handlebars from 'handlebars';
import { chromium } from 'playwright';

import { config } from '../../../../config.js';
import type { PdfAsset } from '../../../../domain/types/asset.js';

Handlebars.registerHelper('join', (arr: unknown, sep: string) => {
  if (!Array.isArray(arr)) return '';
  return arr.join(sep);
});

export function sanitizeSnake(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_')
      .slice(0, 80) || 'unknown'
  );
}

export function buildPdfFilename(meta?: {
  jobId?: string;
  role?: string;
  company?: string;
  location?: string;
}): string {
  const jobId = meta?.jobId?.trim();
  const role = meta?.role?.trim();
  const company = meta?.company?.trim();
  const location = meta?.location?.trim();
  const parts: string[] = [];
  if (role) parts.push(sanitizeSnake(role));
  if (company) parts.push(sanitizeSnake(company));
  if (location) parts.push(sanitizeSnake(location));
  if (parts.length === 0) {
    return `${jobId ? sanitizeSnake(jobId) : 'unknown'}.pdf`;
  }
  const base = parts.join('_');
  const suffix = jobId ? `_${sanitizeSnake(jobId)}` : '';
  // limit total length to avoid filesystem limits
  const filename = `${base}${suffix}.pdf`;
  return filename.length > 200 ? `${filename.slice(0, 200)}.pdf` : filename;
}

export async function renderPdf(
  asset: PdfAsset,
  outputDir: string,
  options?: {
    templatePath?: string;
    format?: 'A4' | 'Letter';
    filename?: string;
    meta?: { jobId?: string; role?: string; company?: string; location?: string };
  }
): Promise<string> {
  const pdfDir = path.join(config.templatesPath, 'pdf');
  const tmplPath = options?.templatePath || path.join(pdfDir, 'pdf.hbs');

  const template = fs.readFileSync(tmplPath, 'utf-8');

  const partialsDir = path.join(pdfDir, 'partials');
  if (fs.existsSync(partialsDir)) {
    const partialFiles = fs.readdirSync(partialsDir);
    for (const file of partialFiles) {
      if (file.endsWith('.hbs')) {
        const name = path.basename(file, '.hbs');
        const content = fs.readFileSync(path.join(partialsDir, file), 'utf-8');
        Handlebars.registerPartial(name, content);
      }
    }
  }

  const compiled = Handlebars.compile(template);
  const html = compiled(asset);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const cssPath = path.join(pdfDir, 'ats.css');
  if (fs.existsSync(cssPath)) {
    fs.copyFileSync(cssPath, path.join(outputDir, 'ats.css'));
  }

  const pdfFilename =
    options?.filename ?? (options?.meta ? buildPdfFilename(options.meta) : 'ats.pdf');
  const htmlFilename = pdfFilename.replace(/\.pdf$/i, '.html');
  const htmlPath = path.join(outputDir, pdfFilename === 'ats.pdf' ? 'ats.html' : htmlFilename);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle' });
    const outputPath = path.join(outputDir, pdfFilename);
    await page.pdf({
      path: outputPath,
      format: options?.format || 'A4',
      printBackground: true,
    });
    return outputPath;
  } finally {
    await browser.close();
  }
}
