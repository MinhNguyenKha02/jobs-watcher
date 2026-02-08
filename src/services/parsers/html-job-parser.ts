/**
 * HTML Job Parser - Extracts job data from email HTML
 * Supports: TopCV, Indeed job alert formats
 * Uses simple regex and string matching instead of JSDOM to avoid test dependencies
 */

import type { JobDetails } from '../../types.js';
import type { IHtmlJobParser, ParsedJobData } from './parser-ports.js';

import { getLogger } from '../logger.js';

const logger = getLogger();

export type { ParsedJobData } from './parser-ports.js';

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]*>/g, ' '));
}

function cleanText(input: string): string {
  return stripHtml(input).replace(/[\s\n]+/g, ' ').trim();
}

function extractMetaUrl(html: string): string {
  const ogMatch = html.match(/property=["']og:url["'][^>]*content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1];

  const canonicalMatch = html.match(/rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (canonicalMatch) return canonicalMatch[1];

  return '';
}

function extractSectionByHeading(html: string, headingPatterns: string[]): string {
  const sections = extractHeadingSections(html);
  for (const headingPattern of headingPatterns) {
    const patternRegex = new RegExp(headingPattern, 'i');
    const match = sections.find(section => patternRegex.test(section.title));
    if (match?.content) {
      return match.content;
    }
  }

  return '';
}

function extractSectionByInlineLabel(html: string, labelPatterns: string[]): string {
  for (const labelPattern of labelPatterns) {
    const labelRegex = new RegExp(
      `<(?:p|div)[^>]*>\\s*<(?:b|strong|i)[^>]*>\\s*(?:${labelPattern})\\s*:??\\s*<\\/(?:b|strong|i)>`,
      'i'
    );
    const match = html.match(labelRegex);
    if (!match || match.index === undefined) continue;

    const start = match.index + match[0].length;
    const rest = html.slice(start);
    const nextLabelIndex = rest.search(/<(?:p|div)[^>]*>\s*<(?:b|strong|i)[^>]*>/i);
    const nextHeadingIndex = rest.search(/<h[23][^>]*>/i);
    const stopIndexCandidates = [nextLabelIndex, nextHeadingIndex].filter(i => i >= 0);
    const stopIndex = stopIndexCandidates.length ? Math.min(...stopIndexCandidates) : -1;
    const sectionHtml = stopIndex >= 0 ? rest.slice(0, stopIndex) : rest;
    const text = cleanText(sectionHtml);
    if (text) return text;
  }

  return '';
}

function extractInlineStrongSections(html: string): TopCvSection[] {
  if (!html) return [];

  const strongRegex = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi;
  const matches = Array.from(html.matchAll(strongRegex));
  const candidates: Array<{ title: string; start: number; end: number }> = [];

  for (const match of matches) {
    if (match.index === undefined) continue;
    const raw = match[1] || '';
    const title = cleanText(raw).replace(/[:：]\s*$/, '');
    if (!title || title.length > 80) continue;

    const before = html.slice(Math.max(0, match.index - 80), match.index);
    const after = html.slice(match.index + match[0].length, match.index + match[0].length + 80);
    const hasBreak = /<br\s*\/?>/i.test(raw) || /<br\s*\/?>/i.test(after);
    const hasLabelPunct = /[:：]$/.test(cleanText(raw));
    const isStandaloneLabel = /<(p|div)[^>]*>\s*$/i.test(before) && /^\s*<\/(p|div)>/i.test(after);
    if (!hasBreak && !hasLabelPunct && !isStandaloneLabel) continue;

    candidates.push({ title, start: match.index, end: match.index + match[0].length });
  }

  if (!candidates.length) return [];

  const sections: TopCvSection[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const current = candidates[i];
    const nextStart = candidates[i + 1]?.start ?? html.length;
    const slice = html.slice(current.end, nextStart);
    const headingIndex = slice.search(/<h[23][^>]*>/i);
    const end = headingIndex >= 0 ? current.end + headingIndex : nextStart;
    const content = cleanText(html.slice(current.end, end));
    if (content) {
      sections.push({ title: current.title, content });
    }
  }

  return sections;
}

function extractElementById(html: string, id: string): string {
  const openTagRegex = new RegExp(`<([a-z0-9]+)[^>]*id=["']${id}["'][^>]*>`, 'i');
  const match = openTagRegex.exec(html);
  if (!match || match.index === undefined) return '';

  const tag = match[1];
  const startIndex = match.index + match[0].length;
  const tagRegex = new RegExp(`<\\/?${tag}[^>]*>`, 'gi');
  tagRegex.lastIndex = startIndex;

  let depth = 1;
  let nextMatch: RegExpExecArray | null = null;
  while ((nextMatch = tagRegex.exec(html))) {
    const token = nextMatch[0];
    if (token.startsWith(`</`)) {
      depth -= 1;
    } else if (!token.endsWith('/>')) {
      depth += 1;
    }

    if (depth === 0) {
      return html.slice(startIndex, nextMatch.index);
    }
  }

  return html.slice(startIndex);
}

function extractHeadingSections(html: string): TopCvSection[] {
  const headingRegex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
  const matches = Array.from(html.matchAll(headingRegex));
  const sections: TopCvSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.index === undefined) continue;
    const title = cleanText(match[1] || '');
    if (!title) continue;

    const start = match.index + match[0].length;
    const end = i + 1 < matches.length && matches[i + 1].index !== undefined
      ? matches[i + 1].index
      : html.length;
    const sectionHtml = html.slice(start, end);
    const content = cleanText(sectionHtml);
    if (content) {
      sections.push({ title, content });
    }
  }

  return sections;
}

function extractHeadingSectionsByClass(html: string, classPattern: string): TopCvSection[] {
  const headingRegex = new RegExp(`<h[23][^>]*class=["'][^"']*(?:${classPattern})[^"']*["'][^>]*>([\\s\\S]*?)<\\/h[23]>`, 'gi');
  const matches = Array.from(html.matchAll(headingRegex));
  const sections: TopCvSection[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (match.index === undefined) continue;
    const title = cleanText(match[1] || '');
    if (!title) continue;

    const start = match.index + match[0].length;
    const end = i + 1 < matches.length && matches[i + 1].index !== undefined
      ? matches[i + 1].index
      : html.length;
    const sectionHtml = html.slice(start, end);
    const content = cleanText(sectionHtml);
    if (content) {
      sections.push({ title, content });
    }
  }

  return sections;
}

function extractElementByClass(html: string, className: string): string {
  const openTagRegex = new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`, 'i');
  const match = openTagRegex.exec(html);
  if (!match || match.index === undefined) return '';

  const tag = match[1];
  const startIndex = match.index + match[0].length;
  const tagRegex = new RegExp(`<\\/?${tag}[^>]*>`, 'gi');
  tagRegex.lastIndex = startIndex;

  let depth = 1;
  let nextMatch: RegExpExecArray | null = null;
  while ((nextMatch = tagRegex.exec(html))) {
    const token = nextMatch[0];
    if (token.startsWith(`</`)) {
      depth -= 1;
    } else if (!token.endsWith('/>')) {
      depth += 1;
    }

    if (depth === 0) {
      return html.slice(startIndex, nextMatch.index);
    }
  }

  return html.slice(startIndex);
}

function mergeDescription(base: string, sections: Array<{ label: string; value?: string }>): string {
  const parts: string[] = [];
  const initial = base?.trim();
  if (initial) parts.push(initial);

  for (const section of sections) {
    const value = section.value?.trim();
    if (!value) continue;
    if (initial && initial.includes(value)) continue;
    parts.push(`${section.label}: ${value}`);
  }

  return parts.join('\n\n').trim();
}

function mergePipeText(...values: Array<string | undefined>): string {
  return values
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value))
    .reduce((acc, value) => {
      if (!value) return acc;
      if (!acc) return value;
      if (acc.includes(value)) return acc;
      return `${acc} | ${value}`;
    }, '');
}

function extractTopCvInfoPairs(html: string, itemClass: string): string {
  const itemRegex = new RegExp(`${itemClass}[^>]*>[\\s\\S]*?item-title[^>]*>([\\s\\S]*?)<\\/div>[\\s\\S]*?item-value[^>]*>([\\s\\S]*?)<\\/div>`, 'gi');
  const pairs = Array.from(html.matchAll(itemRegex))
    .map(match => `${cleanText(match[1] || '')}: ${cleanText(match[2] || '')}`)
    .filter(text => text && !text.endsWith(':'));

  return pairs.join(' | ');
}

type TopCvSection = {
  title: string;
  content: string;
};

function extractTopCvJobDescriptionSections(html: string): TopCvSection[] {
  const itemRegex = /<div class="job-description__item[^"']*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<div class="job-description__item--content"[^>]*>([\s\S]*?)<\/div>/gi;
  return Array.from(html.matchAll(itemRegex))
    .map(match => ({
      title: cleanText(match[1] || ''),
      content: cleanText(match[2] || ''),
    }))
    .filter(section => section.title && section.content);
}

function extractTopCvCustomFormSections(html: string): TopCvSection[] {
  const itemRegex = /custom-form-job__item[^>]*>[\s\S]*?custom-form-job__item--title[^>]*>([\s\S]*?)<\/h3>[\s\S]*?custom-form-job__item--content[^>]*>([\s\S]*?)<\/div>/gi;
  return Array.from(html.matchAll(itemRegex))
    .map(match => ({
      title: cleanText(match[1] || ''),
      content: cleanText(match[2] || ''),
    }))
    .filter(section => section.title && section.content);
}

function extractTopCvJobTags(html: string): Record<string, string> {
  const groupRegex = /<div class="job-tags__group">([\s\S]*?)<\/div>\s*<\/div>/gi;
  const results: Record<string, string> = {};

  for (const match of html.matchAll(groupRegex)) {
    const block = match[1] || '';
    const nameMatch = block.match(/job-tags__group-name[^>]*>([\s\S]*?)<\/div>/i);
    const groupName = cleanText(nameMatch?.[1] || '').replace(/:$/, '');
    if (!groupName) continue;

    const tagMatches = block.matchAll(/class="item[^"']*"[^>]*>([^<]+)</gi);
    const tags = Array.from(tagMatches)
      .map(tagMatch => cleanText(tagMatch[1] || ''))
      .filter(Boolean);

    if (tags.length) {
      results[groupName] = tags.join(', ');
    }
  }

  return results;
}

function extractTopCvGeneralInfo(html: string): string {
  const itemRegex = /box-general-group-info-title[^>]*>([\s\S]*?)<\/div>[\s\S]*?box-general-group-info-value[^>]*>([\s\S]*?)<\/div>/gi;
  const pairs = Array.from(html.matchAll(itemRegex))
    .map(match => `${cleanText(match[1] || '')}: ${cleanText(match[2] || '')}`)
    .filter(text => text && !text.endsWith(':'));

  return pairs.join(' | ');
}

function extractTopCvCompanyInfo(html: string): string {
  const parts: string[] = [];
  const scaleMatch = html.match(/company-scale[\s\S]*?company-value[^>]*>([\s\S]*?)<\/div>/i);
  const fieldMatch = html.match(/company-field[\s\S]*?company-value[^>]*>([\s\S]*?)<\/div>/i);
  const addressMatch = html.match(/company-address[\s\S]*?company-value[^>]*>([\s\S]*?)<\/div>/i);

  if (scaleMatch) parts.push(`Quy mô: ${cleanText(scaleMatch[1] || '')}`);
  if (fieldMatch) parts.push(`Lĩnh vực: ${cleanText(fieldMatch[1] || '')}`);
  if (addressMatch) parts.push(`Địa điểm: ${cleanText(addressMatch[1] || '')}`);

  return parts.join(' | ');
}

export class HtmlJobParser implements IHtmlJobParser {
  /**
   * Extract job data from HTML email
   * Supports: TopCV, Indeed job alert formats
   */
  parseJobFromHtml(html: string): ParsedJobData | null {
    try {
      // Try TopCV format first
      const topcvJob = this.parseTopCV(html);
      if (topcvJob) {
        logger.debug('TopCV format detected', {
          title: topcvJob.title,
          company: topcvJob.company,
          location: topcvJob.location,
          salary: topcvJob.salary,
          hasUrl: !!topcvJob.url,
          hasDescription: !!topcvJob.description,
        });
        return { ...topcvJob, source: 'topcv' };
      }

      // Try Indeed format
      const indeedJob = this.parseIndeed(html);
      if (indeedJob) {
        logger.debug('Indeed format detected', {
          title: indeedJob.title,
          company: indeedJob.company,
          location: indeedJob.location,
          salary: indeedJob.salary,
          hasUrl: !!indeedJob.url,
          hasDescription: !!indeedJob.description,
        });
        return { ...indeedJob, source: 'indeed' };
      }

      // Try LinkedIn format
      const linkedInJob = this.parseLinkedIn(html);
      if (linkedInJob) {
        logger.debug('LinkedIn format detected', {
          title: linkedInJob.title,
          company: linkedInJob.company,
          location: linkedInJob.location,
          salary: linkedInJob.salary,
          hasUrl: !!linkedInJob.url,
          hasDescription: !!linkedInJob.description,
        });
        return { ...linkedInJob, source: 'linkedin' };
      }

      logger.debug('No supported job format detected');
      return null;
    } catch (err) {
      logger.warn(`HTML parse error: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * TopCV format extraction using regex
   */
  private parseTopCV(html: string): ParsedJobData | null {
    // Check if this looks like a TopCV email or detail page
    const htmlLower = html.toLowerCase();
    if (
      !htmlLower.includes('topcv') &&
      !htmlLower.includes('job-item') &&
      !htmlLower.includes('job-detail__info') &&
      !htmlLower.includes('job-detail__info--title') &&
      !htmlLower.includes('job-detail__body')
    ) {
      return null;
    }

    let title = '';
    let company = '';
    let location = '';
    let salary = '';
    let url = '';

    // Title: TopCV detail page <h1 class="job-detail__info--title">...</h1>
    const detailTitleMatch = html.match(/job-detail__info--title[^>]*>([\s\S]*?)<\/h1>/i);
    if (detailTitleMatch) {
      const rawTitle = (detailTitleMatch[1] || '').replace(/<span[^>]*icon-verified-employer[\s\S]*?<\/span>/i, '');
      title = cleanText(rawTitle);
    }

    // Fallback Title: inside <div class="*title"><span>...</span></div>
    if (!title) {
      const titleMatch = html.match(/class="[^"]*title[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)</);
      if (titleMatch) title = titleMatch[1]?.trim() || '';
    }

    // Company: TopCV detail page company block
    const detailCompanyMatch = html.match(/company-name-label[\s\S]*?<a[^>]*class="name"[^>]*>([\s\S]*?)<\/a>/i);
    if (detailCompanyMatch) company = cleanText(detailCompanyMatch[1] || '');

    if (!company) {
      const companyNameMatch = html.match(/company-name-label[\s\S]*?class="company-name"[^>]*>([\s\S]*?)<\/span>/i);
      if (companyNameMatch) company = cleanText(companyNameMatch[1] || '');
    }

    if (!company) {
      const companyInfoMatch = html.match(/job-detail__company--information-item\s+company-name[\s\S]*?<a[^>]*class="name"[^>]*>([\s\S]*?)<\/a>/i);
      if (companyInfoMatch) company = cleanText(companyInfoMatch[1] || '');
    }

    if (!company) {
      const companyInfoSpanMatch = html.match(/job-detail__company--information-item\s+company-name[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i);
      if (companyInfoSpanMatch) company = cleanText(companyInfoSpanMatch[1] || '');
    }

    // Fallback Company: inside <div class="*company"><span>...</span></div>
    if (!company) {
      const companyMatch = html.match(/class="[^"]*company[^"]*"[^>]*>[\s\n]*<span[^>]*>([^<]+)</);
      if (companyMatch) company = companyMatch[1]?.trim() || '';
    }

    // Location: TopCV detail page location block
    const detailLocationMatch = html.match(/section-location[\s\S]*?job-detail__info--section-content-value[^>]*>([\s\S]*?)<\/div>/i);
    if (detailLocationMatch) {
      location = cleanText(detailLocationMatch[1] || '').replace(/\s*\(mới\)\s*/g, '').trim();
    }

    // Fallback Location: look for city names in text
    if (!location) {
      const locationMatches = html.match(/(?:Hà Nội|Hồ Chí Minh|Đà Nẵng|TP\.HCM)[^<\n]*/g);
      if (locationMatches) {
        location = locationMatches[0]
          .replace(/\s*\(mới\)\s*/g, '')
          .replace(/[\s\n]+/g, ' ')
          .trim();
      }
    }

    // Salary: TopCV detail page salary block
    const detailSalaryMatch = html.match(/section-salary[\s\S]*?job-detail__info--section-content-value[^>]*>([\s\S]*?)<\/div>/i);
    if (detailSalaryMatch) salary = cleanText(detailSalaryMatch[1] || '');

    // Fallback Salary: inside <div class="*text-primary"><b>...</b></div>
    if (!salary) {
      const salaryMatch = html.match(/class="[^"]*text-primary[^"]*"[^>]*>[\s\n]*<b[^>]*>([^<]+)</);
      if (salaryMatch) salary = salaryMatch[1]?.trim() || '';
    }

    // URL: job detail link
    const detailUrlMatch = html.match(/https?:\/\/www\.topcv\.vn\/viec-lam\/[^'"\s>]+/i);
    if (detailUrlMatch) url = detailUrlMatch[0] || '';

    if (!url) {
      const metaUrl = extractMetaUrl(html);
      if (metaUrl && /topcv\.vn\/viec-lam\//i.test(metaUrl)) {
        url = metaUrl;
      }
    }

    // Fallback URL: find the job item link
    if (!url) {
      const urlMatch = html.match(/class="[^"]*job-item-link[^"]*"[^>]*href="([^"]+)"/);
      if (urlMatch) url = urlMatch[1] || '';
    }

    // Description: TopCV detail page job description
    let description = '';
    const detailDescMatch = html.match(/<h3>\s*Mô tả công việc\s*<\/h3>[\s\S]*?<div[^>]*class="job-description__item--content"[^>]*>([\s\S]*?)<\/div>/i);
    if (detailDescMatch) description = cleanText(detailDescMatch[1] || '');

    const sections = extractTopCvJobDescriptionSections(html);
    const sectionByTitle = (matcher: (title: string) => boolean): string => {
      const found = sections.find(section => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };

    const responsibilities = extractSectionByHeading(html, [
      'Mô tả công việc',
      'Job Description',
      'Nội dung công việc',
    ]) || sectionByTitle(title => title.includes('mô tả') || title.includes('job description'));

    const requirements = extractSectionByHeading(html, [
      'Yêu cầu ứng viên',
      'Yêu cầu công việc',
      'Requirements',
      'Kinh nghiệm',
    ]) || sectionByTitle(title => title.includes('yêu cầu') || title.includes('requirements') || title.includes('kinh nghiệm'));

    const benefits = extractSectionByHeading(html, [
      'Quyền lợi',
      'Quyền lợi được hưởng',
      'Benefits',
    ]) || sectionByTitle(title => title.includes('quyền lợi') || title.includes('benefit'));

    const applicationProcess = extractSectionByHeading(html, [
      'Cách thức ứng tuyển',
      'Cách ứng tuyển',
      'Application Process',
    ]) || sectionByTitle(title => title.includes('ứng tuyển') || title.includes('apply'));

    const companyInfo = extractSectionByHeading(html, [
      'Thông tin công ty',
      'Giới thiệu công ty',
      'About Company',
    ]) || sectionByTitle(title => title.includes('thông tin công ty') || title.includes('giới thiệu') || title.includes('about company'));

    const contact = extractSectionByHeading(html, [
      'Thông tin liên hệ',
      'Contact Information',
    ]) || sectionByTitle(title => title.includes('liên hệ') || title.includes('contact'));

    const workLocation = sectionByTitle(title => title.includes('địa điểm'));
    const workingTime = sectionByTitle(title => title.includes('thời gian'));

    const tagGroups = extractTopCvJobTags(html);
    const requirementsFromTags = tagGroups['Yêu cầu'] || tagGroups['Yêu cầu ứng viên'] || '';
    const benefitsFromTags = tagGroups['Quyền lợi'] || '';

    const generalInfo = extractTopCvGeneralInfo(html);
    const companyInfoBlock = extractTopCvCompanyInfo(html);

    let companyInfoResolved = companyInfo || companyInfoBlock;
    if (!companyInfoResolved) {
      companyInfoResolved = extractTopCvInfoPairs(html, 'job-detail__company--information-item');
    }

    if (generalInfo) {
      companyInfoResolved = companyInfoResolved
        ? `${companyInfoResolved} | ${generalInfo}`
        : generalInfo;
    }

    let contactResolved = contact;
    if (!contactResolved) {
      contactResolved = extractTopCvInfoPairs(html, 'job-detail__company--contact-item');
    }

    const customFormSections = extractTopCvCustomFormSections(html);
    const customBenefitsText = customFormSections
      .filter(section => /quyền lợi|phụ cấp|benefit/i.test(section.title))
      .map(section => `${section.title}: ${section.content}`)
      .join(' | ');
    const customOtherText = customFormSections
      .filter(section => !/quyền lợi|phụ cấp|benefit/i.test(section.title))
      .map(section => `${section.title}: ${section.content}`)
      .join(' | ');

    const requirementsResolved = requirements || requirementsFromTags;
    const benefitsResolved = mergePipeText(benefits || benefitsFromTags, customBenefitsText);
    const additionalInfoResolved = customOtherText || undefined;

    const details: JobDetails = {
      responsibilities: responsibilities || undefined,
      requirements: requirementsResolved || undefined,
      benefits: benefitsResolved || undefined,
      companyInfo: companyInfoResolved || undefined,
      contact: contactResolved || undefined,
      applicationProcess: applicationProcess || undefined,
      additionalInfo: additionalInfoResolved,
    };

    description = mergeDescription(description, [
      { label: 'Mô tả công việc', value: responsibilities },
      { label: 'Yêu cầu', value: requirementsResolved },
      { label: 'Quyền lợi', value: benefitsResolved },
      { label: 'Phúc lợi bổ sung', value: customBenefitsText },
      { label: 'Ứng tuyển', value: applicationProcess },
      { label: 'Thông tin công ty', value: companyInfoResolved },
      { label: 'Liên hệ', value: contactResolved },
      { label: 'Thông tin bổ sung', value: customOtherText },
      { label: 'Địa điểm làm việc', value: workLocation },
      { label: 'Thời gian làm việc', value: workingTime },
      { label: 'Thông tin chung', value: generalInfo },
    ]);

    if (!title) return null;

    return {
      title,
      company,
      location,
      salary,
      url,
      description: description || undefined,
      details,
    };
  }

  /**
   * Indeed format extraction using regex
   */
  private parseIndeed(html: string): ParsedJobData | null {
    // Check if this looks like an Indeed email or detail page
    if (!html.includes('indeed.com') && !html.includes('jobsearch-JobInfoHeader')) {
      return null;
    }

    let title = '';
    let company = '';
    let location = '';
    let salary = '';
    let url = '';
    let description = '';

    // Title: Indeed detail page <h1 data-testid="jobsearch-JobInfoHeader-title">
      const detailTitleMatch = html.match(/jobsearch-JobInfoHeader-title[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (detailTitleMatch) title = detailTitleMatch[1]?.trim() || '';
      if (title) title = title.replace(/\s*-\s*job post\s*$/i, '').trim();

    // Fallback Title: inside <h2><a>...</a></h2>
    if (!title) {
      const titleMatch = html.match(/<h2[^>]*>[\s\n]*<a[^>]*href="([^"]+)"[^>]*>([^<]+)</);
      if (titleMatch) {
        title = titleMatch[2]?.trim() || '';
        url = titleMatch[1] || '';
      }
    }

    if (!title) return null;

    // Company: Indeed detail page company name (nested tags supported)
    const detailCompanyMatch = html.match(/data-testid="inlineHeader-companyName"[^>]*>([\s\S]*?)<\/div>/i);
    if (detailCompanyMatch) company = cleanText(detailCompanyMatch[1] || '');

    if (!company) {
      const companyNameMatch = html.match(/data-company-name="true"[^>]*>([\s\S]*?)<\//i);
      if (companyNameMatch) company = cleanText(companyNameMatch[1] || '');
    }

    // Location: Indeed detail page location (nested tags supported)
    const detailLocationMatch = html.match(/data-testid="inlineHeader-companyLocation"[^>]*>([\s\S]*?)<\/div>/i);
    if (detailLocationMatch) location = cleanText(detailLocationMatch[1] || '');

    // Salary: Indeed detail page salary block
    const detailSalaryMatch = html.match(/id="salaryInfoAndJobType"[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (detailSalaryMatch) salary = detailSalaryMatch[1]?.trim() || '';

    // Description: Indeed detail page job description
    const descriptionHtml = extractElementById(html, 'jobDescriptionText');
    if (descriptionHtml) {
      description = cleanText(descriptionHtml);
    }

    const descriptionSections = extractHeadingSectionsByClass(descriptionHtml, 'jobSectionHeader');
    const strongSections = extractInlineStrongSections(descriptionHtml);
    const sectionByTitle = (matcher: (title: string) => boolean): string => {
      const found = descriptionSections.find(section => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };
    const strongByTitle = (matcher: (title: string) => boolean): string => {
      const found = strongSections.find(section => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };

    const responsibilities = sectionByTitle(title =>
      title.includes('responsibilities') ||
      title.includes('what you will do') ||
      title.includes("what you'll do") ||
      title.includes('key contributions') ||
      title.includes('job description')
    );
    const requirements = sectionByTitle(title =>
      title.includes('requirements') ||
      title.includes('qualifications') ||
      title.includes("what you'll need") ||
      title.includes('what you will need') ||
      title.includes('skills and experience') ||
      title.includes("what you'll bring")
    );
    const benefits = sectionByTitle(title =>
      title.includes('benefits') ||
      title.includes('what we offer') ||
      title.includes('perks') ||
      title.includes("why you'll love") ||
      title.includes('reasons to join')
    );
    const applicationProcess = sectionByTitle(title =>
      title.includes('application process') ||
      title.includes('how to apply') ||
      title.includes('recruitment process')
    );
    const companyInfo = sectionByTitle(title =>
      title.includes('about') || title.includes('company')
    );
    const contact = sectionByTitle(title => title.includes('contact') || title.includes('hiring team'));

    const strongResponsibilities = strongByTitle(title =>
      title.includes('responsibilities') ||
      title.includes('key responsibilities') ||
      title.includes('job description') ||
      title === 'roles' ||
      title.includes('role')
    );
    const strongRequirements = strongByTitle(title =>
      title.includes('requirements') ||
      title.includes('qualifications') ||
      title.includes('skills') ||
      title.includes('education')
    );
    const strongBenefits = strongByTitle(title =>
      title.includes('benefits') ||
      title.includes('additional information') ||
      title.includes('how we look after you') ||
      title.includes("why you'll love") ||
      title.includes('reasons to join')
    );
    const strongCompanyInfo = strongByTitle(title =>
      title.includes('company') || title.includes('overview') || title.includes('about')
    );

    const inlineResponsibilities = extractSectionByInlineLabel(descriptionHtml, [
      'Responsibilities',
      'Công việc',
      'Nhiệm vụ',
    ]);
    const inlineRequirements = extractSectionByInlineLabel(descriptionHtml, [
      'Requirements',
      'Yêu cầu',
      "What you'll bring",
      'What you will bring',
    ]);
    const inlineBenefits = extractSectionByInlineLabel(descriptionHtml, [
      'Benefits',
      'Quyền lợi',
      'Phúc lợi',
      'Lương',
      'Salary',
      'How we look after you',
      'Working environment',
      'Working Environment',
    ]);
    const inlineCompanyInfo = extractSectionByInlineLabel(descriptionHtml, [
      'Our Company',
      'About us',
      'About Us',
      'The team',
    ]);

    const detailsSections = extractHeadingSectionsByClass(html, 'js-match-insights-provider-1xuczfq');
    const detailsByTitle = (matcher: (title: string) => boolean): string => {
      const found = detailsSections.find(section => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };
    const pay = detailsByTitle(title => title.includes('pay') || title.includes('salary') || title.includes('compensation'));
    const jobType = detailsByTitle(title => title.includes('job type') || title.includes('employment type') || title.includes('loại hình'));

    const responsibilitiesResolved = responsibilities || inlineResponsibilities || strongResponsibilities || sectionByTitle(title => title.includes('responsibilities') || title.includes('key contributions') || title.includes('job description'));
    const requirementsResolved = requirements || inlineRequirements || strongRequirements || sectionByTitle(title => title.includes('requirements') || title.includes("you'll bring") || title.includes('skills'));
    const benefitsResolved = benefits || inlineBenefits || strongBenefits || sectionByTitle(title => title.includes('benefits') || title.includes("why you'll love") || title.includes('reasons to join'));
    const companyInfoResolved = companyInfo || inlineCompanyInfo || strongCompanyInfo || sectionByTitle(title => title.includes('about'));

    const extraSections: Record<string, string> = {};
    const skipContent = new Set([
      responsibilitiesResolved,
      requirementsResolved,
      benefitsResolved,
      companyInfoResolved,
      contact,
      applicationProcess,
    ].filter(Boolean));

    const addExtraSection = (title: string, content: string): void => {
      if (!title || !content) return;
      const titleLower = title.toLowerCase();
      if (titleLower.includes('contact') || titleLower.includes('application')) return;
      if (skipContent.has(content)) return;
      if (!extraSections[title]) {
        extraSections[title] = content;
      }
    };

    for (const section of descriptionSections) {
      addExtraSection(section.title, section.content);
    }
    for (const section of strongSections) {
      addExtraSection(section.title, section.content);
    }

    const details: JobDetails = {
      responsibilities: responsibilitiesResolved || undefined,
      requirements: requirementsResolved || undefined,
      benefits: benefitsResolved || undefined,
      companyInfo: companyInfoResolved || undefined,
      contact: contact || undefined,
      applicationProcess: applicationProcess || undefined,
      pay: pay || undefined,
      jobType: jobType || undefined,
      extraSections: Object.keys(extraSections).length ? extraSections : undefined,
    };

    description = mergeDescription(description, [
      { label: 'Responsibilities', value: responsibilitiesResolved },
      { label: 'Requirements', value: requirementsResolved },
      { label: 'Benefits', value: benefitsResolved },
      { label: 'Application', value: applicationProcess },
      { label: 'Company', value: companyInfoResolved },
      { label: 'Contact', value: contact },
      { label: 'Pay', value: pay },
      { label: 'Job type', value: jobType },
    ]);

    if (!url) {
      const metaUrl = extractMetaUrl(html);
      if (metaUrl && /indeed\.com\/viewjob\?/i.test(metaUrl)) {
        url = metaUrl;
      }
    }

    if (!url) {
      const viewJobMatch = html.match(/https?:\/\/[^"'\s>]*indeed\.com\/viewjob\?[^"'\s>]+/i);
      if (viewJobMatch) url = viewJobMatch[0] || '';
    }

    if (!url) {
      const applyMatch = html.match(/https?:\/\/[^"'\s>]*indeed\.com\/applystart\?[^"'\s>]+/i);
      if (applyMatch) url = applyMatch[0] || '';
    }

    // Fallback Company/Location from email table format
    if (!company || !location) {
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
    }

    // Salary: inside td[bgcolor="#f3f2f1"] > strong
    if (!salary) {
      const salaryMatch = html.match(/bgcolor="#f3f2f1"[^>]*>[\s\n]*<[^>]*><strong[^>]*>([^<]+)</);
      if (salaryMatch) salary = salaryMatch[1]?.trim() || '';
    }

    // Description: first gray text
    if (!description) {
      const descMatch = html.match(/color:#767676[^>]*>([^<]{20,300})<\/td>/);
      if (descMatch) description = descMatch[1]?.trim() || '';
    }

    return {
      title,
      company: company || 'Unknown Company',
      location: location || 'Unknown Location',
      salary: salary || undefined,
      description: description || undefined,
      details,
      url: url || undefined,
    };
  }

  /**
   * LinkedIn job detail parsing using class selectors
   */
  private parseLinkedIn(html: string): ParsedJobData | null {
    if (!html.includes('jobs-search__job-details--wrapper') &&
        !html.includes('jobs-description__content') &&
        !html.includes('job-details-jobs-unified-top-card__job-title')) {
      return null;
    }

    let title = '';
    let company = '';
    let location = '';
    let description = '';

    const ariaTitleMatch = html.match(/jobs-search__job-details--container[\s\S]*?aria-label="([^"]+)"/i);
    if (ariaTitleMatch) title = cleanText(ariaTitleMatch[1] || '');

    const titleMatch = html.match(/job-details-jobs-unified-top-card__job-title[\s\S]*?<h1[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (titleMatch) title = cleanText(titleMatch[1] || '');

    if (!title) {
      const fallbackTitle = html.match(/job-details-jobs-unified-top-card__job-title[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (fallbackTitle) title = cleanText(fallbackTitle[1] || '');
    }

    if (!title) {
      const stickyTitle = html.match(/job-details-jobs-unified-top-card__title-container[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i);
      if (stickyTitle) title = cleanText(stickyTitle[1] || '');
    }

    const companyMatch = html.match(/job-details-jobs-unified-top-card__company-name[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (companyMatch) company = cleanText(companyMatch[1] || '');

    const locationMatch = html.match(/job-details-jobs-unified-top-card__tertiary-description-container[\s\S]*?<span[^>]*tvm__text--low-emphasis[^>]*>([\s\S]*?)<\/span>/i);
    if (locationMatch) location = cleanText(locationMatch[1] || '');

    if (!location) {
      const stickyMeta = html.match(/job-details-jobs-unified-top-card__title-container[\s\S]*?<div class="t-14 truncate">([\s\S]*?)<\/div>/i);
      if (stickyMeta) {
        const metaText = cleanText(stickyMeta[1] || '');
        const parts = metaText.split('·').map(part => part.trim());
        if (parts.length > 1) {
          location = parts.slice(1).join(' · ');
        }
      }
    }

    const descriptionHtml = extractElementById(html, 'job-details') || extractElementByClass(html, 'jobs-description__content');
    if (descriptionHtml) description = cleanText(descriptionHtml);

    const linkedInSections = extractHeadingSectionsByClass(descriptionHtml, 'text-heading-large');
    const strongSections = extractInlineStrongSections(descriptionHtml);
    const sectionByTitle = (matcher: (title: string) => boolean): string => {
      const found = linkedInSections.find(section => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };
    const strongByTitle = (matcher: (title: string) => boolean): string => {
      const found = strongSections.find(section => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };

    const responsibilities = extractSectionByInlineLabel(descriptionHtml, [
      'What You Will Be Doing',
      'What you will be doing',
      'What you will do',
    ]);
    const requirements = extractSectionByInlineLabel(descriptionHtml, [
      'What We Need from You',
      'What we need from you',
      'Requirements',
      'Qualifications',
    ]);
    const benefits = extractSectionByInlineLabel(descriptionHtml, [
      'Benefits',
      'What We Offer',
      'Perks',
    ]);

    const strongResponsibilities = strongByTitle(title =>
      title.includes('responsibilities') || title.includes('key responsibilities')
    );
    const strongRequirements = strongByTitle(title =>
      title.includes('requirements') ||
      title.includes('qualifications') ||
      title.includes('education') ||
      title.includes('technical skills') ||
      title.includes('soft skills')
    );
    const strongBenefits = strongByTitle(title =>
      title.includes('benefits') || title.includes('additional information')
    );
    const strongCompanyInfo = strongByTitle(title =>
      title.includes('company') || title.includes('overview')
    );

    const companyInfoBlock = extractElementByClass(html, 'jobs-company__company-description');
    const companyInfo = companyInfoBlock
      ? cleanText(companyInfoBlock)
      : strongCompanyInfo || sectionByTitle(title => title.includes('about the company'));

    const jobTypeMatch = html.match(/job type is\s*([^.<]+)/i);
    const jobType = jobTypeMatch ? cleanText(jobTypeMatch[1] || '') : cleanText(
      html.match(/job-details-fit-level-preferences[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || ''
    );

    const responsibilitiesResolved = responsibilities || strongResponsibilities || sectionByTitle(title => title.includes('responsibilities'));
    const requirementsResolved = requirements || strongRequirements || sectionByTitle(title => title.includes('requirements') || title.includes('qualifications'));
    const benefitsResolved = benefits || strongBenefits || sectionByTitle(title => title.includes('benefits'));

    const extraSections: Record<string, string> = {};
    const skipContent = new Set([
      responsibilitiesResolved,
      requirementsResolved,
      benefitsResolved,
      companyInfo,
    ].filter(Boolean));

    const addExtraSection = (title: string, content: string): void => {
      if (!title || !content) return;
      if (skipContent.has(content)) return;
      if (!extraSections[title]) {
        extraSections[title] = content;
      }
    };

    for (const section of linkedInSections) {
      addExtraSection(section.title, section.content);
    }
    for (const section of strongSections) {
      addExtraSection(section.title, section.content);
    }

    const details: JobDetails = {
      responsibilities: responsibilitiesResolved || undefined,
      requirements: requirementsResolved || undefined,
      benefits: benefitsResolved || undefined,
      companyInfo: companyInfo || undefined,
      jobType: jobType || undefined,
      extraSections: Object.keys(extraSections).length ? extraSections : undefined,
    };

    if (!title) return null;

    return {
      title,
      company,
      location,
      description: description || undefined,
      details,
    };
  }
}
