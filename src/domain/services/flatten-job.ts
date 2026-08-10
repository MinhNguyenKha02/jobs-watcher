import type { Job, JobDetails } from '../../domain/types/job.js';

const DETAIL_LABELS: Record<string, string> = {
  responsibilities: 'Responsibilities',
  requirements: 'Requirements',
  benefits: 'Benefits',
  companyInfo: 'Company Info',
  contact: 'Contact',
  applicationProcess: 'Application Process',
  additionalInfo: 'Additional Info',
  pay: 'Pay',
  jobType: 'Job Type',
};

export function flattenJobDetails(details: JobDetails | undefined): string {
  if (!details) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' && value.length > 0) {
      const label = DETAIL_LABELS[key] ?? key;
      parts.push(`${label}:\n${value}`);
    }
    if (key === 'extraSections' && typeof value === 'object' && value) {
      for (const [sectionKey, sectionValue] of Object.entries(value as Record<string, string>)) {
        if (sectionValue) {
          parts.push(`${sectionKey}:\n${sectionValue}`);
        }
      }
    }
  }
  return parts.join('\n\n');
}

export function flattenJob(
  job: Pick<Job, 'role' | 'company' | 'description' | 'salary' | 'location' | 'details'>
): string {
  const parts: string[] = [];
  if (job.role) parts.push(`Role:\n${job.role}`);
  if (job.company) parts.push(`Company:\n${job.company}`);
  if (job.description) parts.push(`Description:\n${job.description}`);
  if (job.salary) parts.push(`Salary:\n${job.salary}`);
  if (job.location) parts.push(`Location:\n${job.location}`);
  const detailsStr = flattenJobDetails(job.details);
  if (detailsStr) parts.push(detailsStr);
  return parts.join('\n\n');
}
