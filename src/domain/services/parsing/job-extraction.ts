import { HtmlJobParser, type ParsedJobData } from './html-job-parser.js';

/**
 * Job extraction service - handles extracting jobs from email HTML
 * Supports multiple job formats (TopCV multi-job, single job)
 * Used by: analyze-raw-emails.ts, htmlEnricher.ts
 */

export class JobExtractionService {
  private parser: HtmlJobParser;

  constructor() {
    this.parser = new HtmlJobParser();
  }

  /**
   * Extract all jobs from email HTML
   * Handles TopCV multi-job format and fallback to single-job parsing
   *
   * @param html - Email HTML content
   * @returns Array of parsed job data (may be empty if no jobs found)
   */
  extractAllJobs(html: string): ParsedJobData[] {
    const jobs: ParsedJobData[] = [];

    // Check if this is TopCV with multiple job-items
    if (html.includes('job-item') && html.includes('topcv')) {
      const jobs = this.extractTopCVJobs(html);
      if (jobs.length > 0) {
        return jobs;
      }
    }

    // Fall back to single-job parsing for Indeed, LinkedIn, etc.
    const singleJob = this.parser.parseJobFromHtml(html);
    if (singleJob && singleJob.role) {
      jobs.push(singleJob);
    }

    return jobs;
  }

  /**
   * Extract multiple jobs from TopCV email format
   * TopCV sends emails with multiple job items in a single email
   *
   * @param html - TopCV email HTML
   * @returns Array of parsed jobs from TopCV format
   */
  private extractTopCVJobs(html: string): ParsedJobData[] {
    const jobs: ParsedJobData[] = [];

    // Match: <a class="job-item-link" href="...">...<div class="job-item">...</div>...</a>
    const jobPattern = /<a[^>]*class="[^"]*job-item-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const matches = [...html.matchAll(jobPattern)];

    for (const match of matches) {
      const url = match[1] || '';
      const jobBlock = match[2] || '';

      // Extract title from <div class="title"><span>...</span></div>
      const titleMatch = jobBlock.match(
        /<div[^>]*class="[^"]*title[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)<\/span>/
      );
      const title = titleMatch?.[1]?.trim() || '';

      // Extract company from <div class="company"><span>...</span></div>
      const companyMatch = jobBlock.match(
        /<div[^>]*class="[^"]*company[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)<\/span>/
      );
      const company = companyMatch?.[1]?.trim() || '';

      // Extract location (city names)
      const locationMatch = jobBlock.match(
        />\s*(Hà Nội|Hồ Chí Minh|Đà Nẵng|TP\.HCM|Ho Chi Minh|Ha Noi|Da Nang)\s*</i
      );
      const location = locationMatch?.[1]?.trim() || '';

      // Extract salary from <b> inside text-primary
      const salaryMatch = jobBlock.match(
        /<div[^>]*class="[^"]*text-primary[^"]*"[^>]*>[\s\n]*<b[^>]*>([^<]+)<\/b>/
      );
      const salary = salaryMatch?.[1]?.trim() || '';

      if (title && company) {
        jobs.push({
          role: title,
          company,
          location,
          salary,
          url,
          source: 'topcv',
        });
      }
    }

    return jobs;
  }
}

/**
 * Singleton instance for job extraction
 */
const jobExtractionService = new JobExtractionService();

export function extractAllJobs(html: string): ParsedJobData[] {
  return jobExtractionService.extractAllJobs(html);
}
