import * as cheerio from 'cheerio';
import { type Job } from '../../types/job.js';

export class JobExtractionService {
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
      item.find('div.topcv-job-item > div:not([class])').each((_, d) => {
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
    const $ = cheerio.load(html);
    const jobs: Partial<Job>[] = [];
    $('td.pb-24').each((_, el) => {
      const item = $(el);
      const role = item.find('h2.strong-text-link a').text().trim();
      const url = item.find('h2.strong-text-link a').attr('href') || '';
      if (!role || !url) return;
      const company = item.find('[style*="color:#2d2d2d"]').first().text().trim();
      const locEls = item.find('[style*="color:#2d2d2d"]');
      const location = locEls.length > 1 ? $(locEls[1]).text().trim() : '';
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
}

const jobExtractionService = new JobExtractionService();

export function extractAllJobs(html: string): Partial<Job>[] {
  return jobExtractionService.extractAllJobs(html);
}
