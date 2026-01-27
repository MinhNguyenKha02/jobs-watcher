/**
 * HTML Job Parser - Extracts job data from email HTML
 * Supports: TopCV, Indeed job alert formats
 * Uses simple regex and string matching instead of JSDOM to avoid test dependencies
 */

export interface ParsedJobData {
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  description?: string;
  url?: string;
  source?: 'topcv' | 'indeed' | 'unknown';
}

export class HtmlJobParser {
  /**
   * Extract job data from HTML email
   * Supports: TopCV, Indeed job alert formats
   */
  parseJobFromHtml(html: string): ParsedJobData | null {
    try {
      // Try TopCV format first
      const topcvJob = this.parseTopCV(html);
      if (topcvJob) return { ...topcvJob, source: 'topcv' };

      // Try Indeed format
      const indeedJob = this.parseIndeed(html);
      if (indeedJob) return { ...indeedJob, source: 'indeed' };

      return null;
    } catch (err) {
      console.error(`   ⚠️  HTML parse error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * TopCV format extraction using regex
   */
  private parseTopCV(html: string): ParsedJobData | null {
    // Check if this looks like a TopCV email
    if (!html.includes('topcv') && !html.includes('job-item')) {
      return null;
    }

    let title = '';
    let company = '';
    let location = '';
    let salary = '';
    let url = '';

    // Title: inside <div class="*title"><span>...</span></div>
    const titleMatch = html.match(/class="[^"]*title[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)</);
    if (titleMatch) title = titleMatch[1]?.trim() || '';

    // Company: inside <div class="*company"><span>...</span></div>
    const companyMatch = html.match(/class="[^"]*company[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)</);
    if (companyMatch) company = companyMatch[1]?.trim() || '';

    // Location: look for city names in text
    const locationMatches = html.match(/(?:Hà Nội|Hồ Chí Minh|Đà Nẵng|TP\.HCM)[^<\n]*/g);
    if (locationMatches) {
      location = locationMatches[0]
        .replace(/\s*\(mới\)\s*/g, '')
        .replace(/[\s\n]+/g, ' ')
        .trim();
    }

    // Salary: inside <div class="*text-primary"><b>...</b></div>
    const salaryMatch = html.match(/class="[^"]*text-primary[^"]*"[^>]*>[\s\n]*<b[^>]*>([^<]+)</);
    if (salaryMatch) salary = salaryMatch[1]?.trim() || '';

    // URL: find the job item link
    const urlMatch = html.match(/class="[^"]*job-item-link[^"]*"[^>]*href="([^"]+)"/);
    if (urlMatch) url = urlMatch[1] || '';

    if (!title || !company) return null;

    return { title, company, location, salary, url };
  }

  /**
   * Indeed format extraction using regex
   */
  private parseIndeed(html: string): ParsedJobData | null {
    // Check if this looks like an Indeed email
    if (!html.includes('indeed.com')) {
      return null;
    }

    let title = '';
    let company = '';
    let location = '';
    let salary = '';
    let url = '';
    let description = '';

    // Title: inside <h2><a>...</a></h2>
    const titleMatch = html.match(/<h2[^>]*>[\s\n]*<a[^>]*href="([^"]+)"[^>]*>([^<]+)</);
    if (titleMatch) {
      title = titleMatch[2]?.trim() || '';
      url = titleMatch[1] || '';
    }

    if (!title) return null;

    // Company: first td with short text (before location)
    const tdMatches = html.match(/<td[^>]*color:#2d2d2d[^>]*>([^<]{1,50})<\/td>/g) || [];
    for (const match of tdMatches) {
      const textMatch = match.match(/>([^<]+)<\//);
      const text = textMatch?.[1]?.trim() || '';

      if (
        !text.includes('Thành phố') &&
        !text.includes('Hà Nội') &&
        !text.includes('Hồ Chí Minh') &&
        !text.includes('Đà Nẵng') &&
        text.length > 0 &&
        !company
      ) {
        company = text;
      } else if (
        (text.includes('Thành phố') ||
          text.includes('Hà Nội') ||
          text.includes('Hồ Chí Minh') ||
          text.includes('Đà Nẵng')) &&
        !location
      ) {
        location = text;
      }
    }

    // Salary: inside td[bgcolor="#f3f2f1"] > strong
    const salaryMatch = html.match(/bgcolor="#f3f2f1"[^>]*>[\s\n]*<[^>]*><strong[^>]*>([^<]+)</);
    if (salaryMatch) salary = salaryMatch[1]?.trim() || '';

    // Description: first gray text
    const descMatch = html.match(/color:#767676[^>]*>([^<]{20,300})<\/td>/);
    if (descMatch) description = descMatch[1]?.trim() || '';

    return {
      title,
      company: company || 'Unknown Company',
      location: location || 'Unknown Location',
      salary: salary || undefined,
      description: description || undefined,
      url: url || undefined,
    };
  }
}
