import type { JobDetails } from '../../types.js';

export interface ParsedJobData {
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  description?: string;
  details?: JobDetails;
  url?: string;
  source?: 'topcv' | 'indeed' | 'linkedin' | 'unknown';
}

export interface IHtmlJobParser {
  parseJobFromHtml(html: string): ParsedJobData | null;
}

export interface IPlatformDetector {
  detectPlatform(from: string, body: string): string;
}

export interface IHtmlTextExtractor {
  stripHtml(html: string): string;
}
