import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Job, JobDetails } from '../../types/job.js';
import { createLogger } from '../../../infrastructure/outbound/logging/logger.js';

const logger = createLogger('HtmlParser');

export type ParsedJobData = Partial<Job>;

function cleanText(input: string): string {
  return input.replace(/[\s\n]+/g, ' ').trim();
}

type TopCvSection = {
  title: string;
  content: string;
};

function extractMetaUrl($: CheerioAPI): string {
  return (
    $('meta[property="og:url"]').attr('content') || $('link[rel="canonical"]').attr('href') || ''
  );
}

function extractSectionByHeading($: CheerioAPI, patterns: string[]): string {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    const heading = $('h2, h3')
      .filter((_, el) => regex.test($(el).text()))
      .first();
    if (!heading.length) continue;
    const texts: string[] = [];
    heading.nextUntil('h2, h3').each((_, el) => {
      const t = $(el).text().trim();
      if (t) texts.push(t);
    });
    return cleanText(texts.join(' '));
  }
  return '';
}

function extractSectionByInlineLabel($: CheerioAPI, patterns: string[]): string {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'i');
    const label = $('p strong, p b, div strong, div b')
      .filter((_, el) => {
        return regex.test(
          $(el)
            .text()
            .replace(/[:：]\s*$/, '')
            .trim()
        );
      })
      .first();
    if (!label.length) continue;

    const parent = label.parent();
    const texts: string[] = [];

    const parentClone = parent.clone();
    parentClone.find('strong, b').first().remove();
    const inlineText = cleanText(parentClone.text());
    if (inlineText) texts.push(inlineText);

    let next = parent.next();
    while (next.length) {
      if (next.is('h2, h3')) break;
      if (next.is('p, div') && next.find('> strong, > b').length) break;
      const t = next.text().trim();
      if (t) texts.push(t);
      next = next.next();
    }

    if (texts.length) return cleanText(texts.join(' '));
  }
  return '';
}

function extractInlineStrongSections($: CheerioAPI): TopCvSection[] {
  const candidates: Array<{ el: any; title: string }> = [];

  $('strong, b').each((_, el) => {
    const raw = $(el).text().trim();
    const title = cleanText(raw).replace(/[:：]\s*$/, '');
    if (!title || title.length > 80) return;

    const $parent = $(el).parent();
    const hasBreak = $parent.find('br').length > 0;
    const endsWithColon = /[:：]$/.test(raw);
    const isStandalone =
      $parent.is('p, div') && $parent.children('strong, b').length === $parent.children().length;

    if (hasBreak || endsWithColon || isStandalone) {
      candidates.push({ el, title });
    }
  });

  if (!candidates.length) return [];

  const sections: TopCvSection[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const currentParent = $(candidates[i].el).parent();
    const nextParent = candidates[i + 1]?.el ? $(candidates[i + 1].el).parent() : null;

    const texts: string[] = [];
    let next = currentParent.next();
    while (next.length) {
      if (next.is('h2, h3')) break;
      if (nextParent && next.is(nextParent)) break;
      const t = next.text().trim();
      if (t) texts.push(t);
      next = next.next();
    }
    const content = cleanText(texts.join(' '));
    if (content) sections.push({ title: candidates[i].title, content });
  }

  return sections;
}

function extractHeadingSections($: CheerioAPI): TopCvSection[] {
  const sections: TopCvSection[] = [];
  $('h2, h3').each((_, el) => {
    const title = cleanText($(el).text());
    if (!title) return;
    const texts: string[] = [];
    $(el)
      .nextUntil('h2, h3')
      .each((_, sib) => {
        const t = $(sib).text().trim();
        if (t) texts.push(t);
      });
    const content = cleanText(texts.join(' '));
    if (content) sections.push({ title, content });
  });
  return sections;
}

function extractHeadingSectionsByClass($: CheerioAPI, classPattern: string): TopCvSection[] {
  const sections: TopCvSection[] = [];
  $('h2, h3')
    .filter((_, el) => {
      const cls = $(el).attr('class') || '';
      return cls.includes(classPattern);
    })
    .each((_, el) => {
      const title = cleanText($(el).text());
      if (!title) return;
      const texts: string[] = [];
      $(el)
        .nextUntil('h2, h3')
        .each((_, sib) => {
          const t = $(sib).text().trim();
          if (t) texts.push(t);
        });
      const content = cleanText(texts.join(' '));
      if (content) sections.push({ title, content });
    });
  return sections;
}

function extractTopCvJobDescriptionSections($: CheerioAPI): TopCvSection[] {
  const sections: TopCvSection[] = [];
  $('.job-description__item').each((_, el) => {
    const title = cleanText($(el).find('h3').text());
    const content = cleanText($(el).find('.job-description__item--content').text());
    if (title && content) sections.push({ title, content });
  });
  return sections;
}

function extractTopCvCustomFormSections($: CheerioAPI): TopCvSection[] {
  const sections: TopCvSection[] = [];
  $('[class*="custom-form-job__item"]').each((_, el) => {
    const title = cleanText($(el).find('[class*="custom-form-job__item--title"]').text());
    const content = cleanText($(el).find('[class*="custom-form-job__item--content"]').text());
    if (title && content) sections.push({ title, content });
  });
  return sections;
}

function extractTopCvJobTags($: CheerioAPI): Record<string, string> {
  const results: Record<string, string> = {};
  $('.job-tags__group').each((_, group) => {
    const name = cleanText($(group).find('.job-tags__group-name').text()).replace(/:$/, '');
    if (!name) return;
    const tags = $(group)
      .find('[class*="item"]')
      .map((_, item) => cleanText($(item).text()))
      .get()
      .filter(Boolean);
    if (tags.length) results[name] = tags.join(', ');
  });
  return results;
}

function extractTopCvGeneralInfo($: CheerioAPI): string {
  const pairs: string[] = [];
  $('.box-general-group-info-title').each((_, titleEl) => {
    const label = cleanText($(titleEl).text());
    if (!label) return;
    const valueBlock = $(titleEl).closest('[class*="box-general-group"]');
    const value = cleanText(valueBlock.find('.box-general-group-info-value').text());
    if (value) pairs.push(`${label}: ${value}`);
  });
  return pairs.join(' | ');
}

function extractTopCvCompanyInfo($: CheerioAPI): string {
  const parts: string[] = [];
  const scale = cleanText($('[class*="company-scale"]').find('[class*="company-value"]').text());
  const field = cleanText($('[class*="company-field"]').find('[class*="company-value"]').text());
  const address = cleanText(
    $('[class*="company-address"]').find('[class*="company-value"]').text()
  );
  if (scale) parts.push(`Quy mô: ${scale}`);
  if (field) parts.push(`Lĩnh vực: ${field}`);
  if (address) parts.push(`Địa điểm: ${address}`);
  return parts.join(' | ');
}

function extractTopCvInfoPairs($: CheerioAPI, itemClass: string): string {
  const pairs: string[] = [];
  $(`[class*="${itemClass}"]`).each((_, item) => {
    const title = cleanText($(item).find('[class*="item-title"]').text());
    const value = cleanText($(item).find('[class*="item-value"]').text());
    if (title && value) pairs.push(`${title}: ${value}`);
  });
  return pairs.join(' | ');
}

function isVietnameseCity(text: string): boolean {
  return /Thành phố|Hà Nội|Hồ Chí Minh|Đà Nẵng/.test(text);
}

function mergeDescription(
  base: string,
  sections: Array<{ label: string; value?: string }>
): string {
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
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .reduce((acc, value) => {
      if (!value) return acc;
      if (!acc) return value;
      if (acc.includes(value)) return acc;
      return `${acc} | ${value}`;
    }, '');
}

export class HtmlJobParser {
  parseJobFromHtml(html: string): ParsedJobData | null {
    try {
      if (!html?.trim()) return null;
      const $ = cheerio.load(html);

      const topcvJob = this.parseTopCV($);
      if (topcvJob) {
        logger.debug('TopCV format detected', {
          title: topcvJob.role,
          company: topcvJob.company,
          location: topcvJob.location,
          salary: topcvJob.salary,
          hasUrl: !!topcvJob.url,
          hasDescription: !!topcvJob.description,
        });
        return topcvJob;
      }

      const indeedJob = this.parseIndeed($);
      if (indeedJob) {
        logger.debug('Indeed format detected', {
          title: indeedJob.role,
          company: indeedJob.company,
          location: indeedJob.location,
          salary: indeedJob.salary,
          hasUrl: !!indeedJob.url,
          hasDescription: !!indeedJob.description,
        });
        return indeedJob;
      }

      const linkedInJob = this.parseLinkedIn($);
      if (linkedInJob) {
        logger.debug('LinkedIn format detected', {
          title: linkedInJob.role,
          company: linkedInJob.company,
          location: linkedInJob.location,
          salary: linkedInJob.salary,
          hasUrl: !!linkedInJob.url,
          hasDescription: !!linkedInJob.description,
        });
        return linkedInJob;
      }

      const linkedInSduiJob = this.parseLinkedInSdui($);
      if (linkedInSduiJob) {
        logger.debug('LinkedIn SDUi format detected', {
          title: linkedInSduiJob.role,
          company: linkedInSduiJob.company,
          location: linkedInSduiJob.location,
          deadline: linkedInSduiJob.deadline,
          easyApply: linkedInSduiJob.easyApply,
          hasUrl: !!linkedInSduiJob.url,
          hasDescription: !!linkedInSduiJob.description,
        });
        return linkedInSduiJob;
      }

      logger.debug('No supported job format detected');
      return null;
    } catch (err) {
      logger.warn('HTML parse error', { error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  private parseTopCV($: CheerioAPI): ParsedJobData | null {
    if (
      !$('.job-detail__info--title').length &&
      !$('.job-detail__info').length &&
      !$('.job-detail__body').length
    ) {
      return null;
    }

    let role = '';
    let company = '';
    let location = '';
    let salary = '';
    let url = '';

    const $titleBase = $('.job-detail__info--title').first();
    $titleBase.find('[class*="icon-verified"]').remove();
    role = cleanText($titleBase.text());

    if (!role) {
      const $titleEl = $('[class*="title"]')
        .filter((_, el) => {
          return $(el).is('div') && $(el).find('> span').length > 0;
        })
        .first();
      role = cleanText($titleEl.find('> span').text());
    }

    if (!role) {
      const $altTitle = $(
        '[class*="job-item__title"], [class*="job-item-title"], [class*="job-title"]'
      ).first();
      role = cleanText($altTitle.text());
    }

    company = cleanText($('.company-name-label .name').first().text());
    if (!company) company = cleanText($('[class*="company-name"]').first().text());
    if (!company)
      company = cleanText(
        $('.job-detail__company--information-item.company-name .name').first().text()
      );
    if (!company)
      company = cleanText(
        $('.job-detail__company--information-item.company-name span').first().text()
      );

    if (!company) {
      const $companyDiv = $('div[class*="company"]')
        .filter((_, el) => $(el).find('> span').length > 0)
        .first();
      company = cleanText($companyDiv.find('> span').text());
    }

    if (!company) {
      const $altCompany = $(
        '[class*="job-item__company"], [class*="company-name"], [class*="employer-name"]'
      ).first();
      company = cleanText($altCompany.text());
    }

    const $locationBlock = $('.section-location .job-detail__info--section-content-value').first();
    if ($locationBlock.length) {
      location = cleanText($locationBlock.text())
        .replace(/\s*\(mới\)\s*/g, '')
        .trim();
    }

    if (!location) {
      const html = $.root().text();
      const locMatch = html.match(/(?:Hà Nội|Hồ Chí Minh|Đà Nẵng|TP\.HCM)[^<\n]*/);
      if (locMatch) {
        location = locMatch[0]
          .replace(/\s*\(mới\)\s*/g, '')
          .replace(/[\s\n]+/g, ' ')
          .trim();
      }
    }

    const $salaryBlock = $('.section-salary .job-detail__info--section-content-value').first();
    if ($salaryBlock.length) salary = cleanText($salaryBlock.text());

    if (!salary) {
      const $salaryEl = $('[class*="text-primary"]')
        .filter((_, el) => $(el).find('> b').length > 0)
        .first();
      salary = cleanText($salaryEl.find('> b').text());
    }

    const $detailUrl = $('a[href*="topcv.vn/viec-lam/"]').first();
    if ($detailUrl.length) url = $detailUrl.attr('href') || '';

    if (!url) {
      const metaUrl = extractMetaUrl($);
      if (metaUrl && /topcv\.vn\/viec-lam\//i.test(metaUrl)) url = metaUrl;
    }

    if (!url) {
      const $jobLink = $('[class*="job-item-link"]').first();
      url = $jobLink.attr('href') || '';
    }

    let description = '';

    const $directDesc = $('h3')
      .filter((_, el) => /Mô tả công việc/i.test($(el).text()))
      .first();
    if ($directDesc.length) {
      const $content = $directDesc.nextAll('.job-description__item--content').first();
      if ($content.length) description = cleanText($content.text());
    }

    const sections = extractTopCvJobDescriptionSections($);
    const sectionByTitle = (matcher: (title: string) => boolean): string => {
      const found = sections.find((section) => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };

    const responsibilities =
      extractSectionByHeading($, ['Mô tả công việc', 'Job Description', 'Nội dung công việc']) ||
      sectionByTitle((title) => title.includes('mô tả') || title.includes('job description'));

    let requirements = '';
    let benefits = '';

    const $descContent = $('.job-description__item--content').first();
    if ($descContent.length) {
      const $d = cheerio.load(`<div>${$descContent.html() || ''}</div>`);
      const $req = $d('strong')
        .filter((_, el) => /^Requirements?:?$/i.test($(el).text().trim()))
        .first();
      if ($req.length) {
        const texts: string[] = [];
        $req.nextUntil('strong').each((_, el) => {
          const t = $(el).text().trim();
          if (t) texts.push(t);
        });
        requirements = cleanText(texts.join(' '));
      }

      const $ben = $d('strong')
        .filter((_, el) => /^Benefits?:?$/i.test($(el).text().trim()))
        .first();
      if ($ben.length) {
        const texts: string[] = [];
        $ben.nextUntil('strong').each((_, el) => {
          const t = $(el).text().trim();
          if (t) texts.push(t);
        });
        benefits = cleanText(texts.join(' '));
      }
    }

    if (!requirements) {
      requirements =
        extractSectionByHeading($, [
          'Yêu cầu ứng viên',
          'Yêu cầu công việc',
          'Requirements',
          'Kinh nghiệm',
        ]) ||
        sectionByTitle(
          (title) =>
            title.includes('yêu cầu') ||
            title.includes('requirements') ||
            title.includes('kinh nghiệm')
        );
    }

    if (!benefits) {
      benefits =
        extractSectionByHeading($, ['Quyền lợi', 'Quyền lợi được hưởng', 'Benefits']) ||
        sectionByTitle((title) => title.includes('quyền lợi') || title.includes('benefit'));
    }

    const applicationProcess =
      extractSectionByHeading($, [
        'Cách thức ứng tuyển',
        'Cách ứng tuyển',
        'Application Process',
      ]) || sectionByTitle((title) => title.includes('ứng tuyển') || title.includes('apply'));

    let companyInfo =
      extractSectionByHeading($, ['Thông tin công ty', 'Giới thiệu công ty', 'About Company']) ||
      sectionByTitle(
        (title) =>
          title.includes('thông tin công ty') ||
          title.includes('giới thiệu') ||
          title.includes('about company')
      );

    const contact =
      extractSectionByHeading($, ['Thông tin liên hệ', 'Contact Information']) ||
      sectionByTitle((title) => title.includes('liên hệ') || title.includes('contact'));

    const workLocation = sectionByTitle((title) => title.includes('địa điểm'));
    const workingTime = sectionByTitle((title) => title.includes('thời gian'));

    const tagGroups = extractTopCvJobTags($);
    const requirementsFromTags = tagGroups['Yêu cầu'] || tagGroups['Yêu cầu ứng viên'] || '';
    const benefitsFromTags = tagGroups['Quyền lợi'] || '';

    const generalInfo = extractTopCvGeneralInfo($);
    const companyInfoBlock = extractTopCvCompanyInfo($);

    if (!companyInfo) companyInfo = companyInfoBlock;
    if (!companyInfo)
      companyInfo = extractTopCvInfoPairs($, 'job-detail__company--information-item');

    if (generalInfo) {
      companyInfo = companyInfo ? `${companyInfo} | ${generalInfo}` : generalInfo;
    }

    let contactResolved = contact;
    if (!contactResolved)
      contactResolved = extractTopCvInfoPairs($, 'job-detail__company--contact-item');

    const customFormSections = extractTopCvCustomFormSections($);
    const customBenefitsText = customFormSections
      .filter((section) => /quyền lợi|phụ cấp|benefit/i.test(section.title))
      .map((section) => `${section.title}: ${section.content}`)
      .join(' | ');
    const customOtherText = customFormSections
      .filter((section) => !/quyền lợi|phụ cấp|benefit/i.test(section.title))
      .map((section) => `${section.title}: ${section.content}`)
      .join(' | ');

    const requirementsResolved = requirements || requirementsFromTags;
    const benefitsResolved = mergePipeText(benefits || benefitsFromTags, customBenefitsText);
    const additionalInfoResolved = customOtherText || undefined;

    const details: JobDetails = {
      responsibilities: responsibilities || undefined,
      requirements: requirementsResolved ?? '',
      benefits: benefitsResolved ?? '',
      companyInfo: companyInfo || undefined,
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
      { label: 'Thông tin công ty', value: companyInfo },
      { label: 'Liên hệ', value: contactResolved },
      { label: 'Thông tin bổ sung', value: customOtherText },
      { label: 'Địa điểm làm việc', value: workLocation },
      { label: 'Thời gian làm việc', value: workingTime },
      { label: 'Thông tin chung', value: generalInfo },
    ]);

    if (!role) return null;

    return { role, company, location, salary, url, description: description || undefined, details };
  }

  private parseIndeed($: CheerioAPI): ParsedJobData | null {
    if (!$('[data-testid*="JobInfoHeader"]').length && !$('*:contains("indeed.com")').length) {
      return null;
    }

    let role = '';
    let company = '';
    let location = '';
    let salary = '';
    let url = '';
    let description = '';

    const $titleSpan = $('[data-testid*="JobInfoHeader-title"]').find('span').first();
    if ($titleSpan.length)
      role = cleanText($titleSpan.text())
        .replace(/\s*-\s*job post\s*$/i, '')
        .trim();

    if (!role) {
      const $h2a = $('h2 > a').first();
      if ($h2a.length) {
        role = cleanText($h2a.text());
        url = $h2a.attr('href') || '';
      }
    }

    if (!role) {
      const $alertTitle = $('[class*="job-item"]').find('h2').first();
      if ($alertTitle.length)
        role = cleanText($alertTitle.text())
          .replace(/\s*-\s*job post\s*$/i, '')
          .trim();
    }

    if (!role) return null;

    company = cleanText($('[data-testid*="inlineHeader-companyName"]').first().text());
    if (!company) company = cleanText($('[data-company-name="true"]').first().text());

    if (!company) {
      const $jobItem = $('[class*="job-item"]').first();
      if ($jobItem.length) {
        const $h2 = $jobItem.find('h2').first();
        if ($h2.length) {
          const $p = $h2.next('p').first();
          const firstLine = cleanText($p.text());
          if (firstLine.includes(' - ')) {
            company = firstLine.split(' - ')[0].trim();
          } else {
            company = firstLine.trim();
          }
        }
      }
    }

    location = cleanText($('[data-testid*="inlineHeader-companyLocation"]').first().text());

    const $salarySpan = $('#salaryInfoAndJobType').find('span').first();
    if ($salarySpan.length) salary = cleanText($salarySpan.text());

    const $descEl = $('#jobDescriptionText');
    const descHtmlRaw = $descEl.length ? $descEl.html() || '' : '';
    if (descHtmlRaw) {
      const $d = cheerio.load(descHtmlRaw);
      description = cleanText($d.root().text());
    }

    const descriptionSections = descHtmlRaw
      ? extractHeadingSectionsByClass(cheerio.load(descHtmlRaw), 'jobSectionHeader')
      : [];
    const strongSections = descHtmlRaw
      ? extractInlineStrongSections(cheerio.load(descHtmlRaw))
      : [];
    const sectionByTitle = (matcher: (title: string) => boolean): string => {
      const found = descriptionSections.find((section) => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };
    const strongByTitle = (matcher: (title: string) => boolean): string => {
      const found = strongSections.find((section) => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };

    let responsibilities = sectionByTitle(
      (title) =>
        title.includes('responsibilities') ||
        title.includes('what you will do') ||
        title.includes("what you'll do") ||
        title.includes('key contributions') ||
        title.includes('job description')
    );

    let requirements = '';
    let benefits = '';

    if (descHtmlRaw) {
      const $d = cheerio.load(descHtmlRaw);
      const $req = $d('h2')
        .filter((_, el) => /^Required Qualifications$/i.test($(el).text().trim()))
        .first();
      if ($req.length) {
        const texts: string[] = [];
        $req.nextUntil('h2').each((_, el) => {
          const t = $(el).text().trim();
          if (t) texts.push(t);
        });
        requirements = cleanText(texts.join(' '));
      }

      const $ben = $d('h2')
        .filter((_, el) => /^Benefits$/i.test($(el).text().trim()))
        .first();
      if ($ben.length) {
        const texts: string[] = [];
        $ben.nextUntil('h2').each((_, el) => {
          const t = $(el).text().trim();
          if (t) texts.push(t);
        });
        benefits = cleanText(texts.join(' '));
      }
    }

    if (!requirements) {
      requirements = sectionByTitle(
        (title) =>
          title.includes('requirements') ||
          title.includes('qualifications') ||
          title.includes("what you'll need") ||
          title.includes('what you will need') ||
          title.includes('skills and experience') ||
          title.includes("what you'll bring")
      );
    }

    if (!benefits) {
      benefits = sectionByTitle(
        (title) =>
          title.includes('benefits') ||
          title.includes('what we offer') ||
          title.includes('perks') ||
          title.includes("why you'll love") ||
          title.includes('reasons to join')
      );
    }

    const applicationProcess = sectionByTitle(
      (title) =>
        title.includes('application process') ||
        title.includes('how to apply') ||
        title.includes('recruitment process')
    );

    const companyHeading = sectionByTitle(
      (title) => title.includes('about') || title.includes('company')
    );
    const contactHeading = sectionByTitle(
      (title) => title.includes('contact') || title.includes('hiring team')
    );

    const strongResponsibilities = strongByTitle(
      (title) =>
        title.includes('responsibilities') ||
        title.includes('key responsibilities') ||
        title.includes('job description') ||
        title === 'roles' ||
        title.includes('role')
    );

    const strongRequirements = strongByTitle(
      (title) =>
        title.includes('requirements') ||
        title.includes('qualifications') ||
        title.includes('skills') ||
        title.includes('education')
    );

    const strongBenefits = strongByTitle(
      (title) =>
        title.includes('benefits') ||
        title.includes('additional information') ||
        title.includes('how we look after you') ||
        title.includes("why you'll love") ||
        title.includes('reasons to join')
    );

    const strongCompanyInfo = strongByTitle(
      (title) => title.includes('company') || title.includes('overview') || title.includes('about')
    );

    const inlineResponsibilities = descHtmlRaw
      ? extractSectionByInlineLabel(cheerio.load(descHtmlRaw), [
          'Responsibilities',
          'Công việc',
          'Nhiệm vụ',
        ])
      : '';

    const inlineRequirements = descHtmlRaw
      ? extractSectionByInlineLabel(cheerio.load(descHtmlRaw), [
          'Requirements',
          'Yêu cầu',
          "What you'll bring",
          'What you will bring',
        ])
      : '';

    const inlineBenefits = descHtmlRaw
      ? extractSectionByInlineLabel(cheerio.load(descHtmlRaw), [
          'Benefits',
          'Quyền lợi',
          'Phúc lợi',
          'Lương',
          'Salary',
          'How we look after you',
          'Working environment',
          'Working Environment',
        ])
      : '';

    const inlineCompanyInfo = descHtmlRaw
      ? extractSectionByInlineLabel(cheerio.load(descHtmlRaw), [
          'Our Company',
          'About us',
          'About Us',
          'The team',
        ])
      : '';

    const detailsSections = extractHeadingSectionsByClass($, 'js-match-insights-provider-1xuczfq');
    const detailsByTitle = (matcher: (title: string) => boolean): string => {
      const found = detailsSections.find((section) => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };
    const pay = detailsByTitle(
      (title) => title.includes('pay') || title.includes('salary') || title.includes('compensation')
    );
    const jobType = detailsByTitle(
      (title) =>
        title.includes('job type') ||
        title.includes('employment type') ||
        title.includes('loại hình')
    );

    const responsibilitiesResolved =
      responsibilities ||
      inlineResponsibilities ||
      strongResponsibilities ||
      sectionByTitle(
        (title) =>
          title.includes('responsibilities') ||
          title.includes('key contributions') ||
          title.includes('job description')
      );

    const requirementsResolved =
      requirements ||
      inlineRequirements ||
      strongRequirements ||
      sectionByTitle(
        (title) =>
          title.includes('requirements') ||
          title.includes("you'll bring") ||
          title.includes('skills')
      );

    const benefitsResolved =
      benefits ||
      inlineBenefits ||
      strongBenefits ||
      sectionByTitle(
        (title) =>
          title.includes('benefits') ||
          title.includes("why you'll love") ||
          title.includes('reasons to join')
      );

    const companyInfoResolved =
      companyHeading ||
      inlineCompanyInfo ||
      strongCompanyInfo ||
      sectionByTitle((title) => title.includes('about'));

    const extraSections: Record<string, string> = {};
    const skipContent = new Set(
      [
        responsibilitiesResolved,
        requirementsResolved,
        benefitsResolved,
        companyInfoResolved,
        contactHeading,
        applicationProcess,
      ].filter(Boolean)
    );

    const addExtraSection = (title: string, content: string): void => {
      if (!title || !content) return;
      const titleLower = title.toLowerCase();
      if (titleLower.includes('contact') || titleLower.includes('application')) return;
      if (skipContent.has(content)) return;
      if (!extraSections[title]) extraSections[title] = content;
    };

    for (const section of descriptionSections) addExtraSection(section.title, section.content);
    for (const section of strongSections) addExtraSection(section.title, section.content);

    const details: JobDetails = {
      responsibilities: responsibilitiesResolved || undefined,
      requirements: requirementsResolved ?? '',
      benefits: benefitsResolved ?? '',
      companyInfo: companyInfoResolved || undefined,
      contact: contactHeading || undefined,
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
      { label: 'Contact', value: contactHeading },
      { label: 'Pay', value: pay },
      { label: 'Job type', value: jobType },
    ]);

    if (!url) {
      const metaUrl = extractMetaUrl($);
      if (metaUrl && /indeed\.com\/viewjob\?/i.test(metaUrl)) url = metaUrl;
    }

    if (!url) {
      const $viewJob = $(
        'a[href*="indeed.com/viewjob?"], a[href*="indeed.com/rc/clk/dl?"]'
      ).first();
      url = $viewJob.attr('href') || '';
    }

    if (!url) {
      const $apply = $('a[href*="indeed.com/applystart?"]').first();
      url = $apply.attr('href') || '';
    }

    if (!company || !location) {
      $('td')
        .filter((_, el) => {
          const style = $(el).attr('style') || '';
          return style.includes('color:#2d2d2d');
        })
        .each((_, el) => {
          const text = $(el).text().trim();
          if (!company && text.length > 0 && !isVietnameseCity(text)) {
            company = text;
          } else if (!location && isVietnameseCity(text)) {
            location = text;
          }
        });
    }

    if (!salary) {
      const $salTd = $('td[bgcolor="#f3f2f1"]').find('strong').first();
      salary = cleanText($salTd.text());
    }

    if (!description) {
      const $descTd = $('td')
        .filter((_, el) => {
          const style = $(el).attr('style') || '';
          return style.includes('color:#767676');
        })
        .first();
      if ($descTd.length) {
        const text = $descTd.text().trim();
        if (text.length >= 20 && text.length <= 300) description = text;
      }
    }

    return {
      role,
      company: company || 'Unknown Company',
      location: location || 'Unknown Location',
      salary: salary || undefined,
      description: description || undefined,
      details,
      url: url || undefined,
    };
  }

  private parseLinkedIn($: CheerioAPI): ParsedJobData | null {
    if (
      !$('.jobs-search__job-details--wrapper').length &&
      !$('.jobs-description__content').length &&
      !$('.job-details-jobs-unified-top-card__job-title').length
    ) {
      return null;
    }

    let role = '';
    let company = '';
    let location = '';
    let description = '';

    const $ariaContainer = $('[class*="jobs-search__job-details--container"]').first();
    role = $ariaContainer.attr('aria-label') || '';

    const $titleLink = $('.job-details-jobs-unified-top-card__job-title').find('h1 a').first();
    if ($titleLink.length) role = cleanText($titleLink.text());

    if (!role) {
      const $h1 = $('.job-details-jobs-unified-top-card__job-title').find('h1').first();
      if ($h1.length) role = cleanText($h1.text());
    }

    if (!role) {
      const $stickyTitle = $('.job-details-jobs-unified-top-card__title-container')
        .find('h2')
        .first();
      if ($stickyTitle.length) role = cleanText($stickyTitle.text());
    }

    if (!role) {
      role = cleanText($('meta[property="og:title"]').attr('content') || '')
        .replace(/\s*\|\s*LinkedIn\s*$/i, '')
        .trim();
    }

    if (!role) {
      role = cleanText($('title').text())
        .replace(/\s*\|\s*LinkedIn\s*$/i, '')
        .trim();
    }

    company = cleanText($('.job-details-jobs-unified-top-card__company-name a').first().text());
    if (!company)
      company = cleanText(
        $('.job-details-jobs-unified-top-card__company-name span').first().text()
      );

    const $tertiaryDesc = $('.job-details-jobs-unified-top-card__tertiary-description-container');
    const $locSpan = $tertiaryDesc.find('.tvm__text--low-emphasis').first();
    if ($locSpan.length) location = cleanText($locSpan.text());

    if (!location) {
      const $stickyMeta = $('.job-details-jobs-unified-top-card__title-container')
        .find('.t-14.truncate')
        .first();
      if ($stickyMeta.length) {
        const metaText = cleanText($stickyMeta.text());
        const parts = metaText.split('·').map((part) => part.trim());
        if (parts.length > 1) location = parts.slice(1).join(' · ');
      }
    }

    if (!location) {
      const ogDesc = $('meta[property="og:description"]').attr('content') || '';
      const descParts = ogDesc.split('·').map((part) => part.trim());
      const possibleLoc = descParts.find((part) =>
        /city|vietnam|remote|hà nội|ho chi minh|đà nẵng/i.test(part)
      );
      if (possibleLoc) location = possibleLoc;
    }

    const $descEl = $('#job-details').length
      ? $('#job-details')
      : $('.jobs-description__content').first();
    const descHtmlRaw = $descEl.length ? $descEl.html() || '' : '';
    if (descHtmlRaw) {
      description = cleanText($descEl.text());
    }

    const linkedInSections = descHtmlRaw
      ? extractHeadingSectionsByClass(cheerio.load(descHtmlRaw), 'text-heading-large')
      : [];
    const strongSections = descHtmlRaw
      ? extractInlineStrongSections(cheerio.load(descHtmlRaw))
      : [];
    const sectionByTitle = (matcher: (title: string) => boolean): string => {
      const found = linkedInSections.find((section) => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };
    const strongByTitle = (matcher: (title: string) => boolean): string => {
      const found = strongSections.find((section) => matcher(section.title.toLowerCase()));
      return found?.content || '';
    };

    const $ld = descHtmlRaw ? cheerio.load(descHtmlRaw) : null;
    const inlineResponsibilities = $ld
      ? extractSectionByInlineLabel($ld, [
          'What You Will Be Doing',
          'What you will be doing',
          'What you will do',
        ])
      : '';
    const inlineRequirements = $ld
      ? extractSectionByInlineLabel($ld, [
          'What We Need from You',
          'What we need from you',
          'Requirements',
          'Qualifications',
        ])
      : '';
    const inlineBenefits = $ld
      ? extractSectionByInlineLabel($ld, ['Benefits', 'What We Offer', 'Perks'])
      : '';

    const strongResponsibilities = strongByTitle(
      (title) => title.includes('responsibilities') || title.includes('key responsibilities')
    );
    const strongRequirements = strongByTitle(
      (title) =>
        title.includes('requirements') ||
        title.includes('qualifications') ||
        title.includes('education') ||
        title.includes('technical skills') ||
        title.includes('soft skills')
    );
    const strongBenefits = strongByTitle(
      (title) => title.includes('benefits') || title.includes('additional information')
    );
    const strongCompanyInfo = strongByTitle(
      (title) => title.includes('company') || title.includes('overview')
    );

    const $companyDesc = $('.jobs-company__company-description').first();
    const companyInfo = $companyDesc.length
      ? cleanText($companyDesc.text())
      : strongCompanyInfo || sectionByTitle((title) => title.includes('about the company'));

    let jobType = '';
    const $jobTypeBtn = $('.job-details-fit-level-preferences button strong').first();
    if ($jobTypeBtn.length) {
      jobType = cleanText($jobTypeBtn.text());
    }
    const $allJobTypes = $('.job-details-fit-level-preferences button strong');
    if ($allJobTypes.length > 1) {
      jobType = $allJobTypes
        .map((_, el) => cleanText($(el).text()))
        .get()
        .join(', ');
    }

    const responsibilitiesResolved =
      inlineResponsibilities ||
      strongResponsibilities ||
      sectionByTitle((title) => title.includes('responsibilities'));
    const requirementsResolved =
      inlineRequirements ||
      strongRequirements ||
      sectionByTitle((title) => title.includes('requirements') || title.includes('qualifications'));
    const benefitsResolved =
      inlineBenefits || strongBenefits || sectionByTitle((title) => title.includes('benefits'));

    const extraSections: Record<string, string> = {};
    const skipContent = new Set(
      [responsibilitiesResolved, requirementsResolved, benefitsResolved, companyInfo].filter(
        Boolean
      )
    );
    const addExtraSection = (title: string, content: string): void => {
      if (!title || !content) return;
      if (skipContent.has(content)) return;
      if (!extraSections[title]) extraSections[title] = content;
    };
    for (const section of linkedInSections) addExtraSection(section.title, section.content);
    for (const section of strongSections) addExtraSection(section.title, section.content);

    const details: JobDetails = {
      responsibilities: responsibilitiesResolved || undefined,
      requirements: requirementsResolved || undefined,
      benefits: benefitsResolved || undefined,
      companyInfo: companyInfo || undefined,
      jobType: jobType || undefined,
      extraSections: Object.keys(extraSections).length ? extraSections : undefined,
    };

    if (!role) return null;

    return { role, company, location, description: description || undefined, details };
  }

  private parseLinkedInSdui($: CheerioAPI): ParsedJobData | null {
    const $jobLink = $('a[href*="/jobs/view/"]').first();
    const $aboutJob = $('[componentkey*="JobDetails_AboutTheJob"]');
    if (!$jobLink.length || !$aboutJob.length) return null;

    let role = '';
    let company = '';
    let location = '';
    let salary = '';
    let description = '';
    let url = '';
    let deadline = '';
    let easyApply = false;
    let companyInfo = '';
    const jobTypes: string[] = [];
    let responsibilities = '';
    let requirements = '';
    let benefits = '';
    const extraSections: Record<string, string> = {};

    role = cleanText($jobLink.text());
    url = $jobLink.attr('href') || '';
    if (url && !url.startsWith('http')) {
      url = `https://www.linkedin.com${url}`;
    }

    const $companyAria = $('[aria-label*="Company,"]').first();
    if ($companyAria.length) {
      const ariaLabel = $companyAria.attr('aria-label') || '';
      const match = ariaLabel.match(/Company[,\s]+(.+?)\.?\s*$/);
      if (match) company = match[1].trim();
    }
    if (!company) {
      const $companyAnchor = $('a[href*="/company/"]').first();
      company = cleanText($companyAnchor.text());
    }

    const timePattern =
      /\b(\d+\s+(day|days|week|weeks|month|months|year|years|hour|hours|minute|minutes)\s+ago|just\s+posted|reposted|active\s+\d+\s+day)/i;
    const separatorPattern = /^[·•\s]*$/;
    $('span').each((_, el) => {
      const text = cleanText($(el).text());
      if (!text || separatorPattern.test(text)) return;
      if (!deadline && timePattern.test(text)) {
        deadline = text;
        return;
      }
      if (!location && !timePattern.test(text) && /[,]/.test(text)) {
        location = text;
      }
    });

    easyApply = $('button[aria-label="Easy Apply to this job"]').length > 0;

    $('button li-icon[type="check"]').each((_, icon) => {
      const $btn = $(icon).closest('button');
      if ($btn.length) {
        const typeText = cleanText($btn.find('strong').text());
        if (typeText) jobTypes.push(typeText);
      }
    });
    if (!jobTypes.length) {
      $('a')
        .filter((_, el) => $(el).find('svg#check-small').length > 0)
        .each((_, el) => {
          const typeText = cleanText($(el).find('span').text());
          if (typeText) jobTypes.push(typeText);
        });
    }

    const $aboutJobTextBox = $aboutJob.find('[data-testid="expandable-text-box"]').first();
    if ($aboutJobTextBox.length) {
      description = cleanText($aboutJobTextBox.text());
    }

    const $aboutCompany = $('[componentkey*="JobDetails_AboutTheCompany"]').first();
    if ($aboutCompany.length) {
      const $textBox = $aboutCompany.find('[data-testid="expandable-text-box"]').first();
      if ($textBox.length) {
        companyInfo = cleanText($textBox.text());
      }
    }

    const salaryPattern =
      /(\$[\d,]+(?:\.\d{2})?(?:\s*-\s*\$?[\d,]+(?:\.\d{2})?)?(?:\s*(?:a|per)\s*(?:month|year|hour|day|week))?|[\d,]+(?:\.\d{2})?\s*(?:triệu|vnđ|vnd|usd|đ)\s*(?:\s*-\s*[\d,]+(?:\.\d{2})?\s*(?:triệu|vnđ|vnd|usd|đ)?)?)/i;
    $('span, div, p').each((_, el) => {
      const text = cleanText($(el).text());
      if (
        !salary &&
        salaryPattern.test(text) &&
        text.length < 100 &&
        !text.toLowerCase().includes('about the job')
      ) {
        salary = text;
      }
    });

    if ($aboutJobTextBox.length) {
      const innerHtml = $aboutJobTextBox.html() || '';
      if (innerHtml) {
        const $d = cheerio.load(innerHtml);
        const $body = $d('body');
        const sections: Array<{ title: string; texts: string[] }> = [];
        let currentSection: { title: string; texts: string[] } | null = null;
        $body.contents().each((_, node) => {
          if (node.type === 'tag' && (node.tagName === 'strong' || node.tagName === 'b')) {
            const title = cleanText($d(node).text()).replace(/[:：]\s*$/, '');
            if (title && title.length <= 60) {
              currentSection = { title, texts: [] };
              sections.push(currentSection);
              return;
            }
          }
          if (currentSection) {
            const text = cleanText($d(node).text());
            if (text) currentSection.texts.push(text);
          }
        });

        for (const section of sections) {
          const content = section.texts.join(' ');
          if (!content) continue;
          const lower = section.title.toLowerCase();
          if (
            /^responsibilit|what you('ll| will) be doing|key responsibility|job description/i.test(
              lower
            )
          ) {
            if (!responsibilities) responsibilities = content;
          } else if (
            /^requirement|^qualification|what you('ll| will) need|education|skill|experience|nice to have/i.test(
              lower
            )
          ) {
            if (!requirements) requirements = content;
          } else if (
            /^benefit|perk|what we offer|compensation|additional information/i.test(lower)
          ) {
            if (!benefits) benefits = content;
          } else {
            if (!extraSections[section.title]) extraSections[section.title] = content;
          }
        }
      }
    }

    const knownComponentKeys = ['JobDetails_AboutTheJob', 'JobDetails_AboutTheCompany'];
    $('h2').each((_, h2) => {
      const $h2 = $(h2);
      const $comp = $h2.closest('[componentkey]');
      if ($comp.length) {
        const key = $comp.attr('componentkey') || '';
        if (knownComponentKeys.some((k) => key.includes(k))) return;
      }
      const title = cleanText($h2.text());
      if (!title) return;
      const titleLower = title.toLowerCase();
      if (titleLower === 'about the job' || titleLower === 'about the company') return;
      if (extraSections[title]) return;
      const texts: string[] = [];
      let next = $h2.next();
      while (next.length) {
        if (next.is('h2')) break;
        const t = cleanText(next.text());
        if (t) texts.push(t);
        next = next.next();
      }
      const content = texts.join(' ');
      if (content) extraSections[title] = content;
    });

    if (!role || !company) return null;

    const details: JobDetails = {
      responsibilities: responsibilities || undefined,
      requirements: requirements || undefined,
      benefits: benefits || undefined,
      companyInfo: companyInfo || undefined,
      jobType: jobTypes.length ? jobTypes.join(', ') : undefined,
      extraSections: Object.keys(extraSections).length ? extraSections : undefined,
    };

    return {
      role: role || undefined,
      company: company || undefined,
      location: location || undefined,
      salary: salary || undefined,
      description: description || undefined,
      url: url || undefined,
      deadline: deadline || undefined,
      easyApply,
      details,
    };
  }
}
