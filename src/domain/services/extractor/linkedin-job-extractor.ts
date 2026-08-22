import * as cheerio from 'cheerio';

import type { Job } from '../../types/job.js';
import { htmlToText } from '../html-to-text.js';

export interface ExtractedJobData extends Partial<Job> {
  jobType?: string;
  workLocationType?: string;
}

const JOB_TYPE_PATTERN = /^(Full-time|Part-time|Contract|Internship|Temporary|Freelance)$/;
const WORK_LOCATION_TYPE_PATTERN = /^(On-site|Hybrid|Remote)$/;
const TIME_AGO_PATTERN = /\b(\d+\s+(day|days|week|weeks|month|months|year|years)\s+ago|just\s+posted|reposted)/i;
const SALARY_PATTERN =
  /(\$[\d,]+(?:\.\d{2})?(?:\s*-\s*\$?[\d,]+(?:\.\d{2})?)?(?:\s*(?:a|per)\s*(?:month|year|hour|day|week))?|[\d,]+(?:\.\d{2})?\s*(?:triệu|vnđ|vnd|usd|đ)\s*(?:\s*-\s*[\d,]+(?:\.\d{2})?\s*(?:triệu|vnđ|vnd|usd|đ)?)?)/i;

function cleanText(input: string): string {
  return input.replace(/[\s\n]+/g, ' ').trim();
}

export class LinkedInJobExtractor {
  extract(html: string): ExtractedJobData | null {
    const $ = cheerio.load(html);
    const $jobLink = $('a[href*="/jobs/view/"]').first();
    const $aboutJob = $('[componentkey*="JobDetails_AboutTheJob"]');
    if (!$jobLink.length || !$aboutJob.length) return null;

    const role = cleanText($jobLink.text());
    let url = $jobLink.attr('href') || '';
    if (url && !url.startsWith('http')) url = `https://www.linkedin.com${url}`;

    let company = '';
    const $companyAria = $('[aria-label*="Company,"]').first();
    if ($companyAria.length) {
      const ariaLabel = $companyAria.attr('aria-label') || '';
      const match = ariaLabel.match(/Company[,\s]+(.+?)\.?\s*$/);
      if (match) company = match[1].trim();
    }

    let location = '';
    let deadline = '';
    const $tertiaryP = $('p')
      .filter((_, el) => {
        const text = $(el).text();
        return text.includes('·') && TIME_AGO_PATTERN.test(text);
      })
      .first();
    if ($tertiaryP.length) {
      const parts = $tertiaryP
        .text()
        .split('·')
        .map((p) => cleanText(p))
        .filter(Boolean);
      location = parts[0] || '';
      deadline = parts.find((p) => TIME_AGO_PATTERN.test(p)) || '';
    }

    const easyApply = $('button[aria-label*="Easy Apply"]').length > 0;

    let jobType = '';
    $('a, span').each((_, el) => {
      if (jobType) return;
      const text = cleanText($(el).text());
      if (JOB_TYPE_PATTERN.test(text)) jobType = text;
    });

    let workLocationType = '';
    $('span').each((_, el) => {
      if (workLocationType) return;
      const text = cleanText($(el).text());
      if (WORK_LOCATION_TYPE_PATTERN.test(text)) workLocationType = text;
    });

    let salary = '';
    $('span, div, p').each((_, el) => {
      if (salary) return;
      const text = cleanText($(el).text());
      if (
        salaryPatternMatches(text)
      ) {
        salary = text;
      }
    });

    return {
      role,
      company: company || undefined,
      location: location || undefined,
      salary: salary || undefined,
      description: undefined,
      url: url || undefined,
      deadline: deadline || undefined,
      easyApply,
      details: this.extractDetails(html),
      ...(jobType ? { jobType } : {}),
      ...(workLocationType ? { workLocationType } : {}),
    } as ExtractedJobData;
  }

  private extractDetails(html: string): string {
    return htmlToText(this.removeMetadataElement(html));
  }

  private removeMetadataElement(html: string): string {
    const $ = cheerio.load(html);
    const $metadataRoot = $('[data-testid="lazy-column"] > div').first();
    if (!$metadataRoot.length) return html;
    $metadataRoot.remove();
    return $.html();
  }
}

function salaryPatternMatches(text: string): boolean {
  return (
    SALARY_PATTERN.test(text) &&
    text.length < 100 &&
    !text.toLowerCase().includes('about the job')
  );
}
