/**
 * PDF Generator (Sprint 3A.3)
 * Converts rendered template content to ATS-friendly PDF.
 */

import fs from 'fs';
import path from 'path';

import puppeteer from 'puppeteer';

export interface PdfGenerationOptions {
  executablePath?: string;
  format?: 'A4' | 'Letter';
  marginInches?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

export class PdfGenerator {
  static resolveExecutablePath(): string | undefined {
    const envPath = process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && fs.existsSync(envPath)) {
      return envPath;
    }

    try {
      const bundled = puppeteer.executablePath();
      if (bundled && fs.existsSync(bundled)) {
        return bundled;
      }
    } catch {
      // ignore
    }

    const candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  static async generateFromText(
    content: string,
    outputPath: string,
    options: PdfGenerationOptions = {}
  ): Promise<string> {
    const executablePath = options.executablePath || PdfGenerator.resolveExecutablePath();
    if (!executablePath) {
      throw new Error(
        'No Chrome/Chromium executable found. Set PUPPETEER_EXECUTABLE_PATH to continue.'
      );
    }

    const html = PdfGenerator.renderTextToHtml(content);
    const margin = options.marginInches || { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };

    const browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.pdf({
        path: outputPath,
        format: options.format || 'A4',
        printBackground: true,
        margin: {
          top: `${margin.top ?? 0.5}in`,
          right: `${margin.right ?? 0.5}in`,
          bottom: `${margin.bottom ?? 0.5}in`,
          left: `${margin.left ?? 0.5}in`,
        },
      });
    } finally {
      await browser.close();
    }

    return outputPath;
  }

  private static renderTextToHtml(content: string): string {
    const escaped = PdfGenerator.escapeHtml(content);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
    pre { white-space: pre-wrap; line-height: 1.4; }
  </style>
</head>
<body>
  <pre>${escaped}</pre>
</body>
</html>`;
  }

  private static escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
