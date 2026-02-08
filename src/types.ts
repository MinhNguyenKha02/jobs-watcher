export interface Job {
  id?: string;
  emailId?: string;
  messageId?: string;
  subject?: string;
  from?: string;
  platform: string;
  company: string;
  position: string;
  location?: string;
  description?: string;
  details?: JobDetails;
  salary?: string;
  url?: string;
  rawContent?: string;
  receivedAt?: Date;
  status?: 'queued' | 'applied' | 'skipped';
  createdAt?: Date;
  updatedAt?: Date;
  matchScore?: number; // From skill matching
  matchedSkills?: string[];
}

export interface JobDetails {
  responsibilities?: string;
  requirements?: string;
  benefits?: string;
  companyInfo?: string;
  contact?: string;
  applicationProcess?: string;
  additionalInfo?: string;
  pay?: string;
  jobType?: string;
  extraSections?: Record<string, string>;
}

export interface EnrichedJobMetadata {
  messageId: string;
  timestamp: string;
  jobTitle: string;
  company: string;
  matchScore: number;
  location?: string;
  platform: string;
  url?: string;
  action: string;
  enrichedAt: string;
}

export interface EnrichedJobRecordFile {
  original: {
    position: string;
    company: string;
    location?: string;
    platform: string;
    matchScore: number;
    details?: JobDetails;
  };
  enriched: {
    position: string;
    company: string;
    location?: string;
    description?: string;
    details?: JobDetails;
    matchScore: number;
    fieldsChanged: string[];
  };
}

export interface EnrichedJobRecord extends EnrichedJobRecordFile {
  metadata: EnrichedJobMetadata;
  htmlInput: string;
}

export interface Profile {
  name: string;
  email: string;
  phone: string;
  location: string;
  title: string;
  summary: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
  links: {
    linkedin?: string;
    github?: string;
    portfolio?: string;
    website?: string;
  };
}

export interface Experience {
  company: string;
  position: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string[];
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface ParsedEmail {
  emailId: string;
  subject: string;
  from: string;
  platform: string;
  company?: string;
  position?: string;
  jobTitle?: string; // Alias for position to support constraint filter expectations
  location?: string;
  description?: string;
  details?: JobDetails;
  salary?: string;
  body?: string;
  url?: string;
  applyUrl?: string;
  source?: string;
  rawContent?: string;
  receivedAt: Date;
}

export interface Features {
  tui: boolean;
  notifications: boolean;
  logging: boolean;
}
