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

export async function renderPdf(
  asset: PdfAsset,
  outputDir: string,
  options?: { templatePath?: string; format?: 'A4' | 'Letter' }
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

  const htmlPath = path.join(outputDir, 'ats.html');
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
    const outputPath = path.join(outputDir, 'ats.pdf');
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
