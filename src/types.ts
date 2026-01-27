export interface Job {
  id: string;
  emailId: string;
  subject: string;
  from: string;
  platform: string;
  company: string;
  position: string;
  location?: string;
  description?: string;
  url?: string;
  rawContent: string;
  receivedAt: Date;
  status: 'queued' | 'applied' | 'skipped';
  createdAt: Date;
  updatedAt: Date;
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
  location?: string;
  description?: string;
  url?: string;
  rawContent: string;
  receivedAt: Date;
}

export interface Features {
  tui: boolean;
  notifications: boolean;
  logging: boolean;
}
