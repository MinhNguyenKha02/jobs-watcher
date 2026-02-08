import { textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';

import type { ParsedEmail } from '../../types.js';
import type { IHtmlJobParser, IHtmlTextExtractor, IPlatformDetector } from './parser-ports.js';

import { JOB_PLATFORMS } from '../../constants.js';
import { filterJobCompatibility, normalizeParsedEmail } from '../constraints.js';
import { getLogger } from '../logger.js';
import { HtmlJobParser } from './html-job-parser.js';

const logger = getLogger();

interface EmailInput {
  emailId: string;
  subject: string;
  from: string;
  body: string;
  receivedAt: Date;
}

export interface ParserResult {
  success: boolean;
  data?: ParsedEmail;
  errors: string[];
}

class DefaultPlatformDetector implements IPlatformDetector {
  detectPlatform(from: string, body: string): string {
    const fromLower = from.toLowerCase();
    const bodyLower = body.toLowerCase();

    for (const platform of Object.values(JOB_PLATFORMS).map((p) => ({
      name: p.name,
      domains: p.domains,
      patterns: p.patterns,
    }))) {
      if (platform.domains.some(domain => fromLower.includes(domain))) {
        return platform.name;
      }

      if (platform.patterns.some(pattern => pattern.test(bodyLower))) {
        return platform.name;
      }
    }

    return 'Unknown';
  }
}

class DefaultHtmlTextExtractor implements IHtmlTextExtractor {
  stripHtml(html: string): string {
    try {
      const dom = parseDocument(html);
      return textContent(dom);
    } catch {
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }
}

export class EmailParser {
  private htmlParser: IHtmlJobParser;
  private platformDetector: IPlatformDetector;
  private textExtractor: IHtmlTextExtractor;

  constructor(options?: {
    htmlParser?: IHtmlJobParser;
    platformDetector?: IPlatformDetector;
    textExtractor?: IHtmlTextExtractor;
  }) {
    this.htmlParser = options?.htmlParser ?? new HtmlJobParser();
    this.platformDetector = options?.platformDetector ?? new DefaultPlatformDetector();
    this.textExtractor = options?.textExtractor ?? new DefaultHtmlTextExtractor();
  }

  /**
   * Try HTML parsing first (faster, more accurate for structured emails)
   * Fall back to regex if HTML parsing fails
   */
  parseWithValidation(
    input: EmailInput,
    options: { normalize?: boolean; applyConstraints?: boolean } = {}
  ): ParserResult {
    const normalize = options.normalize ?? true;
    const applyConstraints = options.applyConstraints ?? true;
    const errors: string[] = [];

    // Validate input
    if (!input.emailId?.trim()) {
      errors.push('Missing emailId');
    }
    if (!input.from?.trim()) {
      errors.push('Missing from address');
    }
    if (!input.subject?.trim()) {
      errors.push('Missing subject');
    }
    if (!input.body?.trim()) {
      errors.push('Missing body');
    }
    if (!input.receivedAt) {
      errors.push('Missing receivedAt timestamp');
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    // Step 1: Try HTML parsing (for TopCV/Indeed)
    const htmlJob = this.htmlParser.parseJobFromHtml(input.body);
    if (htmlJob?.title && htmlJob?.company) {
      const platform = this.platformDetector.detectPlatform(input.from, input.body);
      let parsed: ParsedEmail = {
        emailId: input.emailId,
        subject: input.subject,
        from: input.from,
        platform,
        company: htmlJob.company,
        position: htmlJob.title,
        location: htmlJob.location || 'Unknown Location',
        url: htmlJob.url,
        description: htmlJob.description || '',
        details: htmlJob.details,
        rawContent: input.body,
        receivedAt: input.receivedAt,
      };
      
      logger.debug('Email alert parsed (HTML)', {
        platform,
        position: parsed.position,
        company: parsed.company,
        location: parsed.location,
        salary: htmlJob.salary,
        source: htmlJob.source,
      });
      const mergedErrors = [...errors];

      if (normalize) {
        const norm = normalizeParsedEmail(parsed);
        parsed = norm.parsed;
        mergedErrors.push(...norm.warnings.map(w => `Warning: ${w}`));
      }

      if (applyConstraints) {
        const comp = filterJobCompatibility(parsed);
        if (!comp.passed) {
          mergedErrors.push(`Filtered out: ${comp.reasons?.join(', ') || 'incompatible role/experience'}`);
          return { success: false, data: parsed, errors: mergedErrors };
        }
      }

      return { success: true, data: parsed, errors: mergedErrors };
    }

    // Step 2: Fallback to regex-based parsing
    try {
      const platform = this.platformDetector.detectPlatform(input.from, input.body);

      if (!platform || platform === 'Unknown') {
        errors.push('Platform not recognized');
      }

      const cleanBody = this.textExtractor.stripHtml(input.body);

      let company = this.extractCompany(cleanBody, input.subject, platform);
      let position = this.extractPosition(cleanBody, input.subject, platform);

      // Validate extraction
      if (company === 'Unknown Company') {
        errors.push('Could not extract company name');
      }
      if (position === 'Unknown Position') {
        errors.push('Could not extract position title');
      }

      let location = this.extractLocation(cleanBody);
      let url = this.extractUrl(input.body);
      let description = this.extractDescription(cleanBody);

      if (!description) {
        errors.push('Could not extract job description');
      }

      let parsed: ParsedEmail = {
        emailId: input.emailId,
        subject: input.subject,
        from: input.from,
        platform,
        company,
        position,
        location,
        url,
        description,
        rawContent: input.body,
        receivedAt: input.receivedAt,
      };
      // Compute success based on current errors (warnings shouldn't affect this)
      let success = errors.filter(e => !e.includes('Missing') || e.includes('Company') || e.includes('Position')).length === 0;

      const mergedErrors = [...errors];

      if (normalize) {
        const norm = normalizeParsedEmail(parsed);
        parsed = norm.parsed;
        mergedErrors.push(...norm.warnings.map(w => `Warning: ${w}`));
      }

      if (applyConstraints) {
        const comp = filterJobCompatibility(parsed);
        if (!comp.passed) {
          mergedErrors.push(`Filtered out: ${comp.reasons?.join(', ') || 'incompatible role/experience'}`);
          success = false;
          return { success, data: parsed, errors: mergedErrors };
        }
      }

      return {
        success,
        data: parsed,
        errors: mergedErrors,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(`Parsing error: ${message}`);
      errors.push(`Parsing error: ${message}`);
      return { success: false, errors };
    }
  }

  /**
   * Legacy parse method for backward compatibility
   */
  parse(input: EmailInput): ParsedEmail | null {
    const result = this.parseWithValidation(input, {
      normalize: false,
      applyConstraints: false,
    });
    return result.data || null;
  }

  private extractCompany(body: string, subject: string, platform: string): string {
    // Try to extract from subject first
    const subjectPatterns = [
      /(?:from|at|@)\s+([A-Z][A-Za-z\s&]+?)(?:\s+(?:is hiring|has|for|in|-|:|,))/,
      /([A-Z][A-Za-z\s&]+?)\s+(?:is hiring|hiring|job|position)/i,
    ];

    for (const pattern of subjectPatterns) {
      const match = subject.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Try body patterns
    const bodyPatterns = [
      /Company:\s*([^\n]+)/i,
      /Công ty:\s*([^\n]+)/i,
      /Employer:\s*([^\n]+)/i,
      /(?:at|@)\s+([A-Z][A-Za-z\s&]{3,30}?)(?:\n|,|\.)/,
    ];

    for (const pattern of bodyPatterns) {
      const match = body.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return 'Unknown Company';
  }

  private extractPosition(body: string, subject: string, platform: string): string {
    // Try subject first
    const subjectPatterns = [
      /(?:Job Alert|New Job):\s*([^\n\-–]+)/i,
      /([^\n\-–]+?)\s+(?:position|role|job|opening)/i,
      /^([A-Za-z\s\/\-]+?)(?:\s+at|\s+-|\s+@)/,
    ];

    for (const pattern of subjectPatterns) {
      const match = subject.match(pattern);
      if (match) {
        const pos = match[1].trim();
        if (pos.length > 5 && pos.length < 100) {
          return pos;
        }
      }
    }

    // Try body patterns
    const bodyPatterns = [
      /Position:\s*([^\n]+)/i,
      /Job Title:\s*([^\n]+)/i,
      /Vị trí:\s*([^\n]+)/i,
      /Role:\s*([^\n]+)/i,
    ];

    for (const pattern of bodyPatterns) {
      const match = body.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return 'Unknown Position';
  }

  private extractLocation(body: string): string | undefined {
    const patterns = [
      /Location:\s*([^\n]+)/i,
      /Địa điểm:\s*([^\n]+)/i,
      /(?:in|at)\s+(Ho Chi Minh|Hanoi|Ha Noi|Hà Nội|Da Nang|Đà Nẵng|Vietnam|Việt Nam)/i,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return undefined;
  }

  private extractUrl(body: string): string | undefined {
    const urlPatterns = [
      /https?:\/\/[^\s<>"]+?(?:jobs|careers|apply|positions)[^\s<>"]*/gi,
      /https?:\/\/[^\s<>"]+/gi,
    ];

    for (const pattern of urlPatterns) {
      const matches = body.match(pattern);
      if (matches && matches.length > 0) {
        // Return the first job-related URL
        const jobUrl = matches.find(url => 
          /job|career|apply|position|recruit/i.test(url)
        );
        return jobUrl || matches[0];
      }
    }

    return undefined;
  }

  private extractDescription(body: string): string | undefined {
    // Extract first meaningful paragraph (50-500 chars)
    const lines = body.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    for (const line of lines) {
      if (line.length >= 50 && line.length <= 500) {
        return line;
      }
    }

    // Return first 300 chars of body
    if (body.length > 50) {
      return body.substring(0, 300) + '...';
    }

    return undefined;
  }
}
