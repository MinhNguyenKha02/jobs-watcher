import type { Job } from '../../domain/types/job.js';

export function flattenJobDetails(details: string | undefined): string {
  if (!details) return '';
  return details;
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
