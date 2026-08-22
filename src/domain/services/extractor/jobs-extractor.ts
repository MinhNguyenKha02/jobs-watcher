import * as cheerio from 'cheerio';

import { type Job } from '../../types/job.js';

export class JobsExtractor {
  extractAllJobs(html: string): Partial<Job>[] {
    if (html.includes('job-item') && html.includes('topcv')) {
      const jobs = this.extractTopCVJobs(html);
      if (jobs.length > 0) return jobs;
    }
    if (html.includes('indeed') && html.includes('Job Alert')) {
      const jobs = this.extractIndeedJobs(html);
      if (jobs.length > 0) return jobs;
    }
    return [];
  }

  private extractTopCVJobs(html: string): Partial<Job>[] {
    const $ = cheerio.load(html);
    const jobs: Partial<Job>[] = [];
    $('a.job-item-link').each((_, el) => {
      const item = $(el);
      const role = item.find('.title span').text().trim();
      const company = item.find('.company span').text().trim();
      if (!role || !company) return;
      const salary = item.find('.text-primary b').text().trim();
      const url = item.attr('href') || '';
      let location = '';
      let deadline = '';
      item.find('.meta-job .item').each((_, d) => {
        const text = $(d).text().trim();
        if (/ngày để ứng tuyển/i.test(text)) deadline = text;
        else if (/Hà Nội|Hồ Chí Minh|Đà Nẵng|TP\.HCM/i.test(text)) location = text;
      });
      jobs.push({
        role,
        company,
        location: location || undefined,
        salary: salary || undefined,
        url: url || undefined,
        deadline: deadline || undefined,
      });
    });
    return jobs;
  }

  private extractIndeedJobs(html: string): Partial<Job>[] {
    // Real alerts carry job URLs as standalone plain-text lines — their
    // td.pb-24 chrome yields junk via the legacy table path, so gate legacy
    // on that line-level signature.
    const isRealAlertFormat = /^\s*https:\/\/vn\.indeed\.com\/rc\/clk\/\S+\s*$/im.test(html);
    const legacyJobs = isRealAlertFormat ? [] : this.extractIndeedHtmlJobs(html);
    if (legacyJobs.length > 0) return legacyJobs;
    return this.extractIndeedPlainJobs(html);
  }

  private extractIndeedHtmlJobs(html: string): Partial<Job>[] {
    const $ = cheerio.load(html);
    const jobs: Partial<Job>[] = [];
    $('td.pb-24').each((_, el) => {
      const item = $(el);
      const role = item.find('h2 a').text().trim();
      const url = item.find('h2 a').attr('href') || '';
      if (!role || !url) return;
      const infoEls = item.find('div[style*="color:#2d2d2d"]');
      const company = infoEls.first().text().trim();
      const location = infoEls.length > 1 ? $(infoEls[1]).text().trim() : '';
      const salary = item.find('strong').first().text().trim();
      const description = item.find('[style*="color:#767676"]').text().trim();
      const deadline = item.find('[style*="font-size:12px"]').text().trim();
      const easyApply = item.text().includes('Easily apply');
      jobs.push({
        role,
        company,
        location: location || undefined,
        salary: salary || undefined,
        description: description || undefined,
        url,
        deadline: deadline || undefined,
        easyApply,
      });
    });
    return jobs;
  }

  /**
   * Real Indeed Job Alert bodies carry job blocks as plain text lines:
   *   role / "company - location" / salary? / [Easily apply] / description… / age
   * terminated by a bare https://vn.indeed.com/rc/clk/... URL line.
   * A fixed email header precedes job #1 and is stripped before pairing.
   */
  private extractIndeedPlainJobs(body: string): Partial<Job>[] {
    const jobs: Partial<Job>[] = [];
    const urlPattern = /^https:\/\/vn\.indeed\.com\/rc\/clk\/\S+$/i;
    const agePattern = /^(just posted|\d+\s+(?:minute|minutes|min|hour|hours|day|days)\s+ago)$/i;
    const salaryPattern =
      /(?:\d[\d,.]*\s*(?:VNĐ|VND)|\$?\s?\d[\d,.]*(?:\s*-\s*\$?\s?\d[\d,.]*)?\s*(?:VNĐ|VND|a\s+(?:month|year|hour|day|week))|\$\s?\d[\d,.]*|thỏa thuận)/i;
    const headerPatterns: RegExp[] = [
      /^Indeed Job Alert$/i,
      /^\d+\s+new\b.*\bjobs?$/i,
      /^Jobs\s+\d+-\d+\s+of\s+\d+\s+new\s+jobs$/i,
      /^See matching results on Indeed:/i,
    ];

    let buffer: string[] = [];
    const flush = (url: string): void => {
      const fields = buffer.map((line) => line.trim()).filter(Boolean);
      buffer = [];
      if (fields.length < 2) return;

      const role = fields[0];
      if (!role || role.startsWith('<') || headerPatterns.some((p) => p.test(role))) return;

      // Positional grammar: company(-location) is always the second field line.
      const companyLine = fields[1];
      let company = companyLine;
      let location: string | undefined;
      const sep = companyLine.lastIndexOf(' - ');
      if (sep > 0) {
        company = companyLine.slice(0, sep).trim();
        location = companyLine.slice(sep + 3).trim() || undefined;
      }

      let salary: string | undefined;
      let description: string | undefined;
      let deadline: string | undefined;
      let easyApply = false;
      for (let i = 2; i < fields.length; i++) {
        const field = fields[i];
        if (!deadline && agePattern.test(field)) {
          deadline = field;
          continue;
        }
        if (/^easily apply$/i.test(field)) {
          easyApply = true;
          continue;
        }
        if (!salary && !field.endsWith('…') && salaryPattern.test(field)) {
          salary = field;
          continue;
        }
        if (!description && field.endsWith('…')) {
          description = field;
        }
      }

      jobs.push({
        role,
        company,
        location,
        salary,
        description,
        url,
        deadline,
        easyApply,
      });
    };

    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (headerPatterns.some((p) => p.test(trimmed))) continue;
      if (urlPattern.test(trimmed)) {
        flush(trimmed);
      } else {
        buffer.push(trimmed);
      }
    }
    return jobs;
  }
}

const jobsExtractor = new JobsExtractor();

export function extractAllJobs(html: string): Partial<Job>[] {
  return jobsExtractor.extractAllJobs(html);
}
