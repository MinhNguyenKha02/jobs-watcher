import type { Job } from './job.js';

export interface CanonicalJob extends Job {
  subject?: string;
  body?: string;
  payload?: { body?: { data?: string } };
  threadId?: string;
  from?: string;
  to?: string;
}

export interface CanonicalProfile {
  name: string;
  email: string;
  phone: string;
  location: string;
  title: string;
  summary: string;
  experience: Array<{
    company: string;
    position: string;
    startDate: string;
    endDate: string;
    location?: string;
  }>;
  skills: string[];
  normalizedSkills?: Array<{ name: string }>;
}

